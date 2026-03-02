"""
Knowledge Graph Engine — the data backbone for the learning platform.
All other components call this API:
  add_concept(), update_mastery(), get_prerequisites(), get_dependents(), render_graph()
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import networkx as nx

# ── Status thresholds ──────────────────────────────────────────────────────────
MASTERED_THRESHOLD = 0.85
LEARNING_THRESHOLD = 0.60
DECAY_GRACE_DAYS   = 7     # days before decay kicks in
DECAY_PER_DAY      = 0.05  # mastery lost per day after grace period


def _compute_status(mastery: float) -> str:
    if mastery >= MASTERED_THRESHOLD:
        return "mastered"
    if mastery >= LEARNING_THRESHOLD:
        return "learning"
    if mastery > 0:
        return "weak"
    return "not_started"


class KnowledgeGraphEngine:
    """
    Singleton-style class wrapping a NetworkX DiGraph with optional Firestore persistence.

    Each node stores:
        title             str
        category          str
        mastery_score     float   0.0 – 1.0
        status            str     mastered | learning | weak | not_started
        careless_badge    bool
        decay_timestamp   datetime | None  (when decay should start)
        attempt_count     int
        correct_count     int
        careless_count    int     # number of careless mistakes recorded
    """

    def __init__(self, firestore_store=None) -> None:
        self._graph: nx.DiGraph = nx.DiGraph()
        self._fs_store = firestore_store  # FirestoreKnowledgeGraphStore or None

    def _persist_concept(self, concept_id: str) -> None:
        """Write a concept node to Firestore if available."""
        if self._fs_store and concept_id in self._graph:
            data = dict(self._graph.nodes[concept_id])
            self._fs_store.save_concept(concept_id, data)

    def _persist_edge(self, source: str, target: str, edge_type: str = "prerequisite") -> None:
        """Write an edge to Firestore if available."""
        if self._fs_store:
            self._fs_store.save_edge(source, target, edge_type)

    def load_from_firestore(self) -> int:
        """Load the full graph from Firestore into the in-memory NetworkX graph.
        Returns the number of concepts loaded."""
        if not self._fs_store:
            return 0
        concepts = self._fs_store.get_all_concepts()
        edges = self._fs_store.get_all_edges()
        if not concepts:
            return 0
        for concept_id, data in concepts.items():
            self._graph.add_node(concept_id, **data)
        for edge in edges:
            src, tgt = edge["source"], edge["target"]
            if src in self._graph and tgt in self._graph:
                self._graph.add_edge(src, tgt, type=edge.get("type", "prerequisite"))
        return len(concepts)

    # ── Public API ─────────────────────────────────────────────────────────────

    def add_concept(
        self,
        concept_id: str,
        title: str,
        category: str,
        prerequisites: Optional[List[str]] = None,
        initial_mastery: float = 0.0,
        course_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a concept node to the graph.

        prerequisite edges point FROM prerequisite TO this concept
        (i.e. prerequisite → concept means 'prerequisite must be learned first').
        """
        if concept_id in self._graph:
            update_payload = {"title": title, "category": category}
            if course_id:
                update_payload["course_id"] = course_id
            self._graph.nodes[concept_id].update(update_payload)
        else:
            self._graph.add_node(
                concept_id,
                title=title,
                category=category,
                course_id=course_id,
                mastery_score=initial_mastery,
                status=_compute_status(initial_mastery),
                careless_badge=False,
                decay_timestamp=None,
                attempt_count=0,
                correct_count=0,
                careless_count=0,
            )

        if prerequisites:
            for prereq_id in prerequisites:
                if prereq_id in self._graph and not self._graph.has_edge(prereq_id, concept_id):
                    self._graph.add_edge(prereq_id, concept_id, type="prerequisite")
                    self._persist_edge(prereq_id, concept_id, "prerequisite")

        self._persist_concept(concept_id)
        return self._node_dict(concept_id)

    def update_mastery(
        self,
        concept_id: str,
        is_correct: bool,
        is_careless: bool = False,
    ) -> Dict[str, Any]:
        """Record an answer attempt and update mastery/status.

        KEY SPEC RULES:
        - Correct answer   → mastery goes up, reset decay timer
        - Wrong + careless  → badge added, mastery does NOT drop
        - Wrong + conceptual → mastery drops, triggers recursive prerequisite tracing

        Returns the updated node, the affected dependent chain,
        and (for conceptual errors) the deepest weak prerequisite found.
        """
        if concept_id not in self._graph:
            raise KeyError(f"Concept '{concept_id}' not found in graph")

        node = self._graph.nodes[concept_id]
        node["attempt_count"] += 1

        root_gap: Optional[Dict[str, Any]] = None
        prerequisite_gaps: List[Dict[str, Any]] = []

        if is_correct:
            # ── Correct answer ────────────────────────────────────────────────
            node["correct_count"] += 1
            accuracy = node["correct_count"] / node["attempt_count"]
            prior = node["mastery_score"]
            node["mastery_score"] = min(1.0, 0.8 * accuracy + 0.2 * prior)
            node["decay_timestamp"] = (
                datetime.utcnow() + timedelta(days=DECAY_GRACE_DAYS)
            ).isoformat()

        elif is_careless:
            # ── Careless mistake — badge only, mastery unchanged ──────────────
            node["careless_count"] = node.get("careless_count", 0) + 1
            node["careless_badge"] = True
            # Mastery does NOT drop — the student knew this, just rushed.

        else:
            # ── Conceptual mistake — mastery drops + recursive prereq trace ───
            accuracy = node["correct_count"] / node["attempt_count"]
            prior = node["mastery_score"]
            node["mastery_score"] = max(0.0, min(1.0, 0.8 * accuracy + 0.2 * prior))
            node["careless_badge"] = False  # clearly not careless

            # Recursive Prerequisite Knowledge Tracing:
            # Walk BACKWARDS through prerequisite chain to find the deepest weak link
            prerequisite_gaps = self._trace_prerequisite_gaps(concept_id)
            if prerequisite_gaps:
                root_gap = prerequisite_gaps[-1]  # deepest ancestor = root cause

        node["status"] = _compute_status(node["mastery_score"])
        self._persist_concept(concept_id)

        # Collect downstream dependents (for chain-green cascade detection)
        affected_chain = list(nx.descendants(self._graph, concept_id))

        result: Dict[str, Any] = {
            "node": self._node_dict(concept_id),
            "affected_chain": affected_chain,
        }
        if prerequisite_gaps:
            result["prerequisite_gaps"] = prerequisite_gaps
        if root_gap:
            result["root_gap"] = root_gap

        return result

    def diagnose_mistake(
        self,
        concept_id: str,
        student_answer: str,
        correct_answer: str,
        confidence: int,
        openai_client: Any,
    ) -> Dict[str, Any]:
        """Use LLM to classify a mistake as careless or conceptual.

        confidence: 1–5 (how confident the student was before seeing the answer)
        Returns {is_careless: bool, explanation: str, root_gap: ... }
        """
        if concept_id not in self._graph:
            raise KeyError(f"Concept '{concept_id}' not found in graph")

        node_data = self._graph.nodes[concept_id]
        title = node_data.get("title", concept_id)
        prereqs = [
            self._graph.nodes[p].get("title", p)
            for p in self._graph.predecessors(concept_id)
        ]

        prompt = f"""You are an educational AI analyzing a student's mistake.

Concept tested: {title}
Prerequisites for this concept: {', '.join(prereqs) if prereqs else 'None'}
Student's answer: {student_answer}
Correct answer: {correct_answer}
Student's confidence before seeing answer: {confidence}/5

Classify this mistake:
- CARELESS: The student likely understands the concept but made a slip (rushing, arithmetic error, misread the question). High confidence + small error = careless.
- CONCEPTUAL: The student has a genuine gap in understanding. Low confidence or fundamentally wrong approach = conceptual.

Return ONLY valid JSON:
{{
  "is_careless": true or false,
  "explanation": "Brief explanation of why this is careless or conceptual",
  "likely_missing_prerequisite": "Name of prerequisite concept they might be missing, or null if careless"
}}"""

        response = openai_client.chat.completions.create(
            model="gpt-5.2",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )

        classification = json.loads(response.choices[0].message.content)
        is_careless = classification.get("is_careless", False)

        # Now update mastery using the classification
        mastery_result = self.update_mastery(concept_id, is_correct=False, is_careless=is_careless)

        return {
            "is_careless": is_careless,
            "explanation": classification.get("explanation", ""),
            "likely_missing_prerequisite": classification.get("likely_missing_prerequisite"),
            **mastery_result,
        }

    def _trace_prerequisite_gaps(self, concept_id: str) -> List[Dict[str, Any]]:
        """Recursive Prerequisite Knowledge Tracing.

        Walks BACKWARD through the prerequisite chain from concept_id,
        collecting every weak or not_started ancestor, ordered from
        nearest to deepest (deepest = root cause).
        """
        gaps: List[Dict[str, Any]] = []
        visited: set[str] = set()

        def _walk(node_id: str) -> None:
            for prereq_id in self._graph.predecessors(node_id):
                if prereq_id in visited:
                    continue
                visited.add(prereq_id)
                prereq = self._graph.nodes[prereq_id]
                status = prereq.get("status", "not_started")
                if status in ("weak", "not_started"):
                    gaps.append(self._node_dict(prereq_id))
                    _walk(prereq_id)  # keep tracing deeper

        _walk(concept_id)
        return gaps

    def get_prerequisites(self, concept_id: str) -> List[Dict[str, Any]]:
        """Return direct prerequisite nodes."""
        if concept_id not in self._graph:
            return []
        return [self._node_dict(p) for p in self._graph.predecessors(concept_id)]

    def get_dependents(self, concept_id: str) -> List[Dict[str, Any]]:
        """Return direct dependent nodes."""
        if concept_id not in self._graph:
            return []
        return [self._node_dict(d) for d in self._graph.successors(concept_id)]

    def get_prerequisite_chain(self, concept_id: str) -> List[str]:
        """Return ALL ancestors of a concept (full upstream chain)."""
        if concept_id not in self._graph:
            return []
        return list(nx.ancestors(self._graph, concept_id))

    def get_graph_data(self) -> Dict[str, Any]:
        """Serialize the entire graph as {nodes, links} for D3 consumption."""
        self.apply_decay()
        nodes = [self._node_dict(n) for n in self._graph.nodes()]
        links = [
            {
                "source": u,
                "target": v,
                "type": data.get("type", "related"),
            }
            for u, v, data in self._graph.edges(data=True)
        ]
        return {"nodes": nodes, "links": links}

    def render_graph(self) -> str:
        """Generate an interactive HTML visualization using Pyvis."""
        from pyvis.network import Network

        net = Network(
            height="700px",
            width="100%",
            directed=True,
            bgcolor="#ffffff",
            font_color="#333333",
        )
        net.barnes_hut(gravity=-3000, central_gravity=0.3, spring_length=120)

        status_colors = {
            "mastered":    "#22c55e",
            "learning":    "#eab308",
            "weak":        "#ef4444",
            "not_started": "#d1d5db",
        }

        for node_id, data in self._graph.nodes(data=True):
            mastery = data.get("mastery_score", 0.0)
            status = data.get("status", "not_started")
            title_str = data.get("title", node_id)
            color = status_colors.get(status, "#d1d5db")
            size = 15 + mastery * 20
            label = f"{title_str}\n{round(mastery * 100)}%"

            tooltip = (
                f"<b>{title_str}</b><br>"
                f"Mastery: {round(mastery * 100)}%<br>"
                f"Status: {status}<br>"
                f"Attempts: {data.get('correct_count', 0)}/{data.get('attempt_count', 0)}"
            )
            if data.get("careless_badge"):
                tooltip += "<br><span style='color:#f59e0b'>⚠ Careless errors detected</span>"

            net.add_node(
                node_id,
                label=label,
                title=tooltip,
                color=color,
                size=size,
                borderWidth=2,
                borderWidthSelected=4,
            )

        for u, v, data in self._graph.edges(data=True):
            edge_type = data.get("type", "related")
            net.add_edge(
                u, v,
                color="#94a3b8" if edge_type == "prerequisite" else "#e2e8f0",
                width=2 if edge_type == "prerequisite" else 1,
                dashes=edge_type != "prerequisite",
                arrows="to",
                title=edge_type,
            )

        return net.generate_html()

    def apply_decay(self) -> None:
        """Reduce mastery for nodes whose decay_timestamp has passed."""
        now = datetime.utcnow()
        for node_id, data in self._graph.nodes(data=True):
            ts = data.get("decay_timestamp")
            if not ts:
                continue
            decay_start = datetime.fromisoformat(ts)
            if now > decay_start:
                days_overdue = (now - decay_start).days
                loss = DECAY_PER_DAY * max(1, days_overdue)
                data["mastery_score"] = max(0.0, data["mastery_score"] - loss)
                data["status"] = _compute_status(data["mastery_score"])
                self._persist_concept(node_id)

    def build_from_material(
        self,
        text: str,
        openai_client: Any,
        course_id: Optional[str] = None,
        course_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Use OpenAI to extract concepts + prerequisites from course text."""
        course_context = f"\nCourse: {course_name}\nCourse ID: {course_id}\n" if course_name or course_id else ""
        prompt = f"""You are a knowledge graph extractor for an educational platform.
Given the following course material, extract a list of concepts and their prerequisites.

Return ONLY valid JSON with this exact structure:
{{
  "concepts": [
    {{
      "id": "unique_snake_case_id",
      "title": "Human Readable Title",
      "category": "Subject Area",
      "prerequisites": ["id_of_prereq1", "id_of_prereq2"]
    }}
  ]
}}

Rules:
- IDs must be unique snake_case strings
- Prerequisites must reference IDs of other concepts in the list
- Order concepts from foundational to advanced
- Extract 5–15 concepts maximum

{course_context}
Course material:
{text[:4000]}"""

        response = openai_client.chat.completions.create(
            model="gpt-5.2",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content
        data = json.loads(raw)
        concepts = data.get("concepts", [])

        added = []
        # First pass: add all nodes
        for c in concepts:
            self.add_concept(
                concept_id=c["id"],
                title=c["title"],
                category=course_name or c.get("category", "General"),
                prerequisites=[],
                course_id=course_id,
            )
        # Second pass: add prerequisite edges
        for c in concepts:
            for prereq in c.get("prerequisites", []):
                if prereq in self._graph and c["id"] in self._graph:
                    if not self._graph.has_edge(prereq, c["id"]):
                        self._graph.add_edge(prereq, c["id"], type="prerequisite")
                        self._persist_edge(prereq, c["id"], "prerequisite")
            added.append(self._node_dict(c["id"]))

        return added

    # ── Internal helpers ────────────────────────────────────────────────────────

    def _node_dict(self, node_id: str) -> Dict[str, Any]:
        data = self._graph.nodes[node_id]
        return {
            "id": node_id,
            "title": data.get("title", node_id),
            "category": data.get("category", "General"),
            "courseId": data.get("course_id"),
            "mastery": round(data.get("mastery_score", 0.0) * 100),
            "status": data.get("status", "not_started"),
            "carelessBadge": data.get("careless_badge", False),
            "carelessCount": data.get("careless_count", 0),
            "decayTimestamp": data.get("decay_timestamp"),
            "attemptCount": data.get("attempt_count", 0),
            "correctCount": data.get("correct_count", 0),
        }


# ── Module-level singleton ─────────────────────────────────────────────────────
kg_engine = KnowledgeGraphEngine()


def init_kg_engine(firestore_store=None) -> KnowledgeGraphEngine:
    """Re-initialise the global kg_engine with optional Firestore persistence."""
    global kg_engine
    kg_engine = KnowledgeGraphEngine(firestore_store=firestore_store)
    # Try to load existing graph from Firestore
    loaded = kg_engine.load_from_firestore()
    if loaded > 0:
        print(f"Loaded {loaded} concepts from Firestore.")
    return kg_engine


def seed_demo_data() -> None:
    """Pre-populate the graph with Physics 101 + Data Structures for the demo."""
    # Physics 101
    kg_engine.add_concept("n1law", "Newton's 1st Law", "Physics", [], 0.92)
    kg_engine.add_concept("n2law", "Newton's 2nd Law", "Physics", ["n1law"], 0.78)
    kg_engine.add_concept("n3law", "Newton's 3rd Law", "Physics", ["n2law"], 0.45)
    kg_engine.add_concept("fbd", "Free Body Diagrams", "Physics", ["n1law"], 0.85)
    kg_engine.add_concept("friction", "Friction", "Physics", ["fbd"], 0.60)
    kg_engine.add_concept("momentum", "Momentum", "Physics", ["n3law"], 0.30)
    kg_engine.add_concept("kinetic_e", "Kinetic Energy", "Physics", [], 0.70)
    kg_engine.add_concept("potential_e", "Potential Energy", "Physics", [], 0.40)
    kg_engine.add_concept("work_energy", "Work-Energy Theorem", "Physics", ["kinetic_e"], 0.55)
    kg_engine.add_concept("cons_energy", "Conservation of Energy", "Physics", ["potential_e", "work_energy"], 0.0)

    # Data Structures
    kg_engine.add_concept("arrays", "Arrays", "Data Structures", [], 0.95)
    kg_engine.add_concept("linked_lists", "Linked Lists", "Data Structures", ["arrays"], 0.88)
    kg_engine.add_concept("binary_trees", "Binary Trees", "Data Structures", ["linked_lists"], 0.65)
    kg_engine.add_concept("graph_algos", "Graph Algorithms", "Data Structures", ["binary_trees"], 0.20)

    # Add related edge
    if not kg_engine._graph.has_edge("fbd", "friction"):
        kg_engine._graph.add_edge("fbd", "friction", type="related")
