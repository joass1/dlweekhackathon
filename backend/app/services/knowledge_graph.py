"""
Knowledge Graph Engine — the data backbone for the learning platform.
All other components call this API:
  add_concept(), update_mastery(), get_prerequisites(), get_dependents(), render_graph()
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from math import exp, log
from typing import Any, Dict, List, Optional

import networkx as nx

from .adaptive_engine import AdaptiveEngine, ConceptState

# ── Status thresholds ──────────────────────────────────────────────────────────
MASTERED_THRESHOLD = 0.85
LEARNING_THRESHOLD = 0.60
DEFAULT_DECAY_RATE = 0.02
LEGACY_DECAY_GRACE_DAYS = 7
REVIEW_DUE_RISK_THRESHOLD = 0.35


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _ensure_utc(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return _ensure_utc(datetime.fromisoformat(text.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


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
        self._adaptive_engine = AdaptiveEngine()

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
        topic_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Add a concept node to the graph.

        prerequisite edges point FROM prerequisite TO this concept
        (i.e. prerequisite → concept means 'prerequisite must be learned first').
        """
        incoming_topic_ids = [
            str(topic).strip()
            for topic in (topic_ids or [])
            if str(topic).strip()
        ]

        if concept_id in self._graph:
            update_payload = {
                "title": title,
                "category": category,
                "decay_rate": float(self._graph.nodes[concept_id].get("decay_rate", DEFAULT_DECAY_RATE) or DEFAULT_DECAY_RATE),
            }
            if course_id:
                update_payload["course_id"] = course_id
            existing_topics = self._graph.nodes[concept_id].get("topic_ids") or self._graph.nodes[concept_id].get("topicIds") or []
            merged_topics = list(
                dict.fromkeys(
                    [
                        *[str(topic).strip() for topic in existing_topics if str(topic).strip()],
                        *incoming_topic_ids,
                    ]
                )
            )
            if merged_topics:
                update_payload["topic_ids"] = merged_topics
            self._graph.nodes[concept_id].update(update_payload)
        else:
            now = _utc_now()
            self._graph.add_node(
                concept_id,
                title=title,
                category=category,
                course_id=course_id,
                topic_ids=incoming_topic_ids,
                mastery_score=initial_mastery,
                status=_compute_status(initial_mastery),
                careless_badge=False,
                decay_timestamp=None,
                review_due_at=None,
                updated_at=now.isoformat() if initial_mastery > 0 else None,
                last_practice_at=now.isoformat() if initial_mastery > 0 else None,
                decay_rate=DEFAULT_DECAY_RATE,
                attempt_count=0,
                correct_count=0,
                careless_count=0,
            )
            if initial_mastery > 0:
                self._sync_review_schedule(self._graph.nodes[concept_id], now)

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
        confidence_1_to_5: Optional[int] = None,
        classification_source: Optional[str] = None,
        classification_model: Optional[str] = None,
        missing_concept: Optional[str] = None,
        classification_rationale: Optional[str] = None,
        classified_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record an answer attempt and update mastery/status.

        KEY SPEC RULES:
        - Correct answer   → mastery goes up, reset decay timer
        - Wrong + careless  → badge added, mastery does NOT drop
        - Wrong + conceptual → mastery drops (scaled by confidence), triggers recursive prerequisite tracing
        - Status is always derived from the score — no forced overrides on wrong answers

        Returns the updated node, the affected dependent chain,
        and (for conceptual errors) the deepest weak prerequisite found.
        """
        if concept_id not in self._graph:
            raise KeyError(f"Concept '{concept_id}' not found in graph")

        node = self._graph.nodes[concept_id]
        now = _utc_now()
        node["mastery_score"] = self._project_mastery(concept_id, node, as_of=now)
        node["attempt_count"] += 1

        root_gap: Optional[Dict[str, Any]] = None
        prerequisite_gaps: List[Dict[str, Any]] = []

        if is_correct:
            # ── Correct answer ────────────────────────────────────────────────
            node["correct_count"] += 1
            prior = float(node.get("mastery_score", 0.0))
            base_gain = 0.06 + 0.14 * (1.0 - prior)
            if confidence_1_to_5 is None:
                confidence_factor = 1.0
            else:
                clamped_conf = max(1, min(5, int(confidence_1_to_5)))
                # Confidence weighting: level 1 ("guessing") gets only 25% of
                # normal gain; level 5 gets full gain.
                confidence_factor = 0.25 + 0.75 * ((clamped_conf - 1) / 4.0)
            gain = base_gain * confidence_factor
            node["mastery_score"] = min(1.0, prior + gain)

        elif is_careless:
            # ── Careless mistake — badge only, mastery unchanged ──────────────
            node["careless_count"] = node.get("careless_count", 0) + 1
            node["careless_badge"] = True
            # Mastery does NOT drop — the student knew this, just rushed.

        else:
            # ── Conceptual mistake — mastery drops + recursive prereq trace ───
            prior = float(node.get("mastery_score", 0.0))
            # Low confidence + wrong = bigger drop (you weren't sure and still got it wrong)
            if confidence_1_to_5 is None:
                confidence_factor = 1.0
            else:
                clamped_conf = max(1, min(5, int(confidence_1_to_5)))
                # Confidence 1 ("guessing") → 1.5× drop; confidence 5 → 0.75× drop
                confidence_factor = 1.5 - 0.75 * ((clamped_conf - 1) / 4.0)
            drop = (0.08 + 0.10 * prior) * confidence_factor
            node["mastery_score"] = max(0.0, prior - drop)
            node["careless_badge"] = False  # clearly not careless

            # Recursive Prerequisite Knowledge Tracing:
            # Walk BACKWARDS through prerequisite chain to find the deepest weak link
            prerequisite_gaps = self._trace_prerequisite_gaps(concept_id)
            if prerequisite_gaps:
                root_gap = prerequisite_gaps[-1]  # deepest ancestor = root cause

        node["status"] = _compute_status(node["mastery_score"])
        # Correct answer on a not_started concept → at least learning
        if is_correct and node["status"] in {"not_started", "weak"}:
            node["status"] = "learning"

        node["updated_at"] = now.isoformat()
        node["last_practice_at"] = now.isoformat()
        self._sync_review_schedule(node, now)

        if not is_correct:
            node["last_mistake_type"] = "careless" if is_careless else "conceptual"
            node["last_missing_concept"] = missing_concept
            node["last_classification_source"] = classification_source
            node["last_classification_model"] = classification_model
            node["last_classification_rationale"] = classification_rationale
            node["last_classified_at"] = classified_at or now.isoformat()

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

    def set_mastery(self, concept_id: str, mastery_score: float) -> Dict[str, Any]:
        """Set a concept mastery score directly (0.0 to 1.0)."""
        if concept_id not in self._graph:
            raise KeyError(f"Concept '{concept_id}' not found in graph")

        clamped = max(0.0, min(1.0, float(mastery_score)))
        node = self._graph.nodes[concept_id]
        now = _utc_now()
        node["mastery_score"] = clamped
        node["status"] = _compute_status(clamped)
        node["updated_at"] = now.isoformat()
        node["last_practice_at"] = now.isoformat()
        self._sync_review_schedule(node, now)
        self._persist_concept(concept_id)
        return self._node_dict(concept_id)

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
        mastery_result = self.update_mastery(
            concept_id,
            is_correct=False,
            is_careless=is_careless,
            classification_source="openai",
            classification_model="gpt-5.2",
            missing_concept=classification.get("likely_missing_prerequisite"),
            classification_rationale=classification.get("explanation"),
        )

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

    def remove_nodes_by_course(self, course_id: str) -> int:
        """Remove all KG nodes belonging to a course. Returns count removed."""
        to_remove = [
            n for n in self._graph.nodes()
            if str(self._graph.nodes[n].get("course_id") or "").strip() == str(course_id).strip()
        ]
        for node_id in to_remove:
            for neighbor in list(self._graph.predecessors(node_id)) + list(self._graph.successors(node_id)):
                if self._fs_store:
                    try:
                        self._fs_store.delete_edge(neighbor, node_id)
                        self._fs_store.delete_edge(node_id, neighbor)
                    except Exception:
                        pass
            self._graph.remove_node(node_id)
            if self._fs_store:
                try:
                    self._fs_store.delete_concept(node_id)
                except Exception:
                    pass
        return len(to_remove)

    def remove_nodes_by_topic(self, topic_id: str) -> int:
        """Remove topic_id from all nodes. Delete nodes that have no remaining topics."""
        to_remove = []
        to_update = []
        for n in self._graph.nodes():
            data = self._graph.nodes[n]
            topic_ids = list(data.get("topic_ids") or data.get("topicIds") or [])
            if topic_id not in topic_ids:
                continue
            remaining = [t for t in topic_ids if t != topic_id]
            if not remaining:
                to_remove.append(n)
            else:
                to_update.append((n, remaining))

        for node_id in to_remove:
            for neighbor in list(self._graph.predecessors(node_id)) + list(self._graph.successors(node_id)):
                if self._fs_store:
                    try:
                        self._fs_store.delete_edge(neighbor, node_id)
                        self._fs_store.delete_edge(node_id, neighbor)
                    except Exception:
                        pass
            self._graph.remove_node(node_id)
            if self._fs_store:
                try:
                    self._fs_store.delete_concept(node_id)
                except Exception:
                    pass

        for node_id, remaining in to_update:
            self._graph.nodes[node_id]["topic_ids"] = remaining
            self._persist_concept(node_id)

        return len(to_remove)

    def get_graph_data(self) -> Dict[str, Any]:
        """Serialize the entire graph as {nodes, links} for D3 consumption."""
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
        """Materialize projected exponential decay into stored mastery values."""
        now = _utc_now()
        for node_id, data in self._graph.nodes(data=True):
            projected_mastery = self._project_mastery(node_id, data, as_of=now)
            if abs(projected_mastery - float(data.get("mastery_score", 0.0))) <= 1e-9:
                continue
            data["mastery_score"] = projected_mastery
            data["status"] = _compute_status(projected_mastery)
            data["updated_at"] = now.isoformat()
            data["last_practice_at"] = now.isoformat()
            self._sync_review_schedule(data, now)
            self._persist_concept(node_id)

    def build_from_material(
        self,
        text: str,
        openai_client: Any,
        course_id: Optional[str] = None,
        course_name: Optional[str] = None,
        topic_id: Optional[str] = None,
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
                topic_ids=[topic_id] if topic_id else [],
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
        projected = self._project_decay_metrics(node_id, data)
        course_id = data.get("course_id") or data.get("courseId")
        topic_ids = data.get("topic_ids") or data.get("topicIds") or []
        normalized_topic_ids = [
            str(topic_id).strip()
            for topic_id in topic_ids
            if str(topic_id).strip()
        ]
        return {
            "id": node_id,
            "title": data.get("title", node_id),
            "category": data.get("category", "General"),
            "courseId": course_id,
            "topicIds": normalized_topic_ids,
            "mastery": round(projected["mastery"] * 100),
            "status": projected["status"],
            "carelessBadge": data.get("careless_badge", False),
            "carelessCount": data.get("careless_count", 0),
            "decayTimestamp": projected["review_due_at"],
            "decayRisk": round(projected["decay_risk"], 4),
            "dueForReview": projected["due_for_review"],
            "updatedAt": data.get("updated_at"),
            "lastPracticeAt": projected["last_practice_at"],
            "attemptCount": data.get("attempt_count", 0),
            "correctCount": data.get("correct_count", 0),
            "lastMistakeType": data.get("last_mistake_type"),
            "lastMissingConcept": data.get("last_missing_concept"),
            "lastClassificationSource": data.get("last_classification_source"),
            "lastClassificationModel": data.get("last_classification_model"),
            "lastClassificationRationale": data.get("last_classification_rationale"),
            "lastClassifiedAt": data.get("last_classified_at"),
        }

    def _sync_review_schedule(self, node: Dict[str, Any], reference_time: datetime) -> None:
        mastery = _clamp(float(node.get("mastery_score", 0.0)))
        if mastery <= 0:
            node["review_due_at"] = None
            node["decay_timestamp"] = None
            return

        decay_rate = max(0.0, float(node.get("decay_rate", DEFAULT_DECAY_RATE) or DEFAULT_DECAY_RATE))
        review_due_at = _ensure_utc(reference_time) + timedelta(days=self._review_due_days(decay_rate))
        node["decay_rate"] = decay_rate
        node["review_due_at"] = review_due_at.isoformat()
        node["decay_timestamp"] = node["review_due_at"]

    def _review_due_days(self, decay_rate: float) -> float:
        safe_rate = max(1e-6, float(decay_rate or DEFAULT_DECAY_RATE))
        return -log(max(1e-6, 1.0 - REVIEW_DUE_RISK_THRESHOLD)) / safe_rate

    def _last_practice_at(self, data: Dict[str, Any]) -> Optional[datetime]:
        direct = _parse_dt(data.get("last_practice_at"))
        if direct is not None:
            return direct

        updated = _parse_dt(data.get("updated_at"))
        if updated is not None:
            return updated

        legacy_due = _parse_dt(data.get("decay_timestamp"))
        if legacy_due is None:
            return None
        return legacy_due - timedelta(days=LEGACY_DECAY_GRACE_DAYS)

    def _project_mastery(
        self,
        concept_id: str,
        data: Dict[str, Any],
        as_of: Optional[datetime] = None,
    ) -> float:
        mastery = _clamp(float(data.get("mastery_score", 0.0)))
        last_practice_at = self._last_practice_at(data)
        if mastery <= 0 or last_practice_at is None:
            return mastery

        state = ConceptState(
            concept_id=concept_id,
            mastery=mastery,
            decay_rate=max(0.0, float(data.get("decay_rate", DEFAULT_DECAY_RATE) or DEFAULT_DECAY_RATE)),
            last_updated=last_practice_at,
            attempts=int(data.get("attempt_count", 0) or 0),
            correct=int(data.get("correct_count", 0) or 0),
            careless_count=int(data.get("careless_count", 0) or 0),
        ).normalized()
        projected = self._adaptive_engine.get_mastery(
            state,
            as_of=as_of,
            include_decay_projection=True,
        )
        return _clamp(float(projected["mastery"]))

    def _project_decay_metrics(
        self,
        concept_id: str,
        data: Dict[str, Any],
        as_of: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        now = _ensure_utc(as_of or _utc_now())
        mastery = self._project_mastery(concept_id, data, as_of=now)
        last_practice_at = self._last_practice_at(data)
        decay_rate = max(0.0, float(data.get("decay_rate", DEFAULT_DECAY_RATE) or DEFAULT_DECAY_RATE))

        elapsed_days = 0.0
        if last_practice_at is not None:
            elapsed_days = max(0.0, (now - last_practice_at).total_seconds() / 86400.0)

        decay_risk = 0.0 if mastery <= 0 or last_practice_at is None else 1.0 - exp(-decay_rate * elapsed_days)
        review_due_at = _parse_dt(data.get("review_due_at"))
        if review_due_at is None and last_practice_at is not None and mastery > 0:
            review_due_at = last_practice_at + timedelta(days=self._review_due_days(decay_rate))

        return {
            "mastery": mastery,
            "status": _compute_status(mastery),
            "decay_risk": _clamp(decay_risk),
            "due_for_review": bool(review_due_at and now >= review_due_at and mastery > 0),
            "review_due_at": review_due_at.isoformat() if review_due_at else None,
            "last_practice_at": last_practice_at.isoformat() if last_practice_at else None,
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
