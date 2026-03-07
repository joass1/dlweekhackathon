"""
Firestore-backed persistence for all Mentora data domains.

Collections:
  students/{student_id}                  — profile doc (blind_spot_counts)
  students/{student_id}/quizzes/{qid}    — active quiz questions
  students/{student_id}/attempts/{auto}  — attempt history records
  students/{student_id}/classifications/{qid} — mistake classifications
  students/{student_id}/concept_states/{cid}  — BKT mastery state

  knowledge_graphs/{graph_id}/concepts/{cid}  — graph nodes
  knowledge_graphs/{graph_id}/edges/{eid}     — graph edges
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from google.cloud.firestore_v1 import Client as FirestoreClient


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ──────────────────────────────────────────────────────────────────────────────
# Assessment State Store (replaces JSON file)
# ──────────────────────────────────────────────────────────────────────────────

class FirestoreAssessmentStore:
    """Drop-in replacement for the JSON-file-based AssessmentStateStore."""

    def __init__(self, db: FirestoreClient):
        self.db = db

    # ── Quiz questions ────────────────────────────────────────────────────────

    def save_quiz(self, student_id: str, questions: Dict[str, dict]) -> None:
        """Save a student's active quiz questions."""
        batch = self.db.batch()
        col = self.db.collection("students").document(student_id).collection("quizzes")
        for qid, q_data in questions.items():
            batch.set(col.document(qid), q_data)
        batch.commit()

    def get_quiz(self, student_id: str) -> Dict[str, dict]:
        """Load all active quiz questions for a student."""
        col = self.db.collection("students").document(student_id).collection("quizzes")
        docs = col.stream()
        return {doc.id: doc.to_dict() for doc in docs}

    def save_single_question(self, student_id: str, question_id: str, q_data: dict) -> None:
        """Save a single quiz question (e.g. micro-checkpoint)."""
        self.db.collection("students").document(student_id) \
            .collection("quizzes").document(question_id).set(q_data)

    # ── Attempt history ───────────────────────────────────────────────────────

    def add_attempt(self, student_id: str, attempt: dict) -> None:
        """Append an attempt record."""
        self.db.collection("students").document(student_id) \
            .collection("attempts").add(attempt)

    def get_attempts(self, student_id: str) -> List[dict]:
        """Get all attempt history for a student, ordered by timestamp."""
        try:
            col = self.db.collection("students").document(student_id) \
                .collection("attempts").order_by("timestamp")
            return [doc.to_dict() for doc in col.stream()]
        except Exception:
            col = self.db.collection("students").document(student_id) \
                .collection("attempts")
            return [doc.to_dict() for doc in col.stream()]

    # ── Classifications ───────────────────────────────────────────────────────

    def save_classification(self, student_id: str, question_id: str, data: dict) -> None:
        self.db.collection("students").document(student_id) \
            .collection("classifications").document(question_id).set(data)

    def get_classification(self, student_id: str, question_id: str) -> Optional[dict]:
        doc = self.db.collection("students").document(student_id) \
            .collection("classifications").document(question_id).get()
        return doc.to_dict() if doc.exists else None

    def get_all_classifications(self, student_id: str) -> Dict[str, dict]:
        col = self.db.collection("students").document(student_id) \
            .collection("classifications")
        return {doc.id: doc.to_dict() for doc in col.stream()}

    # ── Blind spot counts ─────────────────────────────────────────────────────

    def get_blind_spots(self, student_id: str) -> dict:
        doc = self.db.collection("students").document(student_id).get()
        if doc.exists:
            data = doc.to_dict()
            return data.get("blind_spot_counts", {"found": 0, "resolved": 0})
        return {"found": 0, "resolved": 0}

    def update_blind_spots(self, student_id: str, blind_spots: dict) -> None:
        self.db.collection("students").document(student_id).set(
            {"blind_spot_counts": blind_spots}, merge=True
        )

    # ── Assessment runs ─────────────────────────────────────────────────────

    def get_assessment_runs(self, student_id: str) -> List[dict]:
        try:
            col = self.db.collection("students").document(student_id) \
                .collection("assessment_runs").order_by("submitted_at")
            return [doc.to_dict() for doc in col.stream()]
        except Exception:
            # Fallback without ordering if index is missing
            col = self.db.collection("students").document(student_id) \
                .collection("assessment_runs")
            return [doc.to_dict() for doc in col.stream()]

    def add_assessment_run(self, student_id: str, run: dict) -> None:
        self.db.collection("students").document(student_id) \
            .collection("assessment_runs").add(run)

    # ── Transaction helper (mimics old API) ───────────────────────────────────

    def transaction(self, student_id: str):
        """
        Returns (state_dict, commit_fn) to preserve the same call pattern
        used by AssessmentEngine.  The state dict is loaded fresh from Firestore.
        """
        state = {
            "quizzes": {student_id: self.get_quiz(student_id)},
            "attempt_history": {student_id: self.get_attempts(student_id)},
            "classification_store": {student_id: self.get_all_classifications(student_id)},
            "blind_spot_counts": {student_id: self.get_blind_spots(student_id)},
            "assessment_runs": {student_id: self.get_assessment_runs(student_id)},
        }

        # Snapshot list lengths NOW, before the engine mutates state in place.
        # Without this, old_len == new len at commit time (same list object).
        old_attempt_len = len(state["attempt_history"].get(student_id, []))
        old_run_len = len(state["assessment_runs"].get(student_id, []))

        def commit(new_state: Dict[str, Any]) -> None:
            # Save quizzes
            new_quiz = new_state.get("quizzes", {}).get(student_id, {})
            if new_quiz:
                self.save_quiz(student_id, new_quiz)
            # Save attempt history (only new ones)
            new_attempts = new_state.get("attempt_history", {}).get(student_id, [])
            for attempt in new_attempts[old_attempt_len:]:
                self.add_attempt(student_id, attempt)
            # Save classifications
            new_cls = new_state.get("classification_store", {}).get(student_id, {})
            for qid, cls_data in new_cls.items():
                self.save_classification(student_id, qid, cls_data)
            # Save blind spots
            new_blind = new_state.get("blind_spot_counts", {}).get(student_id)
            if new_blind:
                self.update_blind_spots(student_id, new_blind)
            # Save assessment runs (only new ones)
            new_runs = new_state.get("assessment_runs", {}).get(student_id, [])
            for run in new_runs[old_run_len:]:
                self.add_assessment_run(student_id, run)

        return state, commit


# ──────────────────────────────────────────────────────────────────────────────
# Knowledge Graph Store (persists NetworkX graph to Firestore)
# ──────────────────────────────────────────────────────────────────────────────

class FirestoreKnowledgeGraphStore:
    """Persist knowledge graph nodes and edges to Firestore."""

    def __init__(self, db: FirestoreClient, graph_id: str = "default"):
        self.db = db
        self.graph_id = graph_id
        self._base = self.db.collection("knowledge_graphs").document(graph_id)

    def save_concept(self, concept_id: str, data: dict) -> None:
        self._base.collection("concepts").document(concept_id).set(data, merge=True)

    def get_concept(self, concept_id: str) -> Optional[dict]:
        doc = self._base.collection("concepts").document(concept_id).get()
        return doc.to_dict() if doc.exists else None

    def get_all_concepts(self) -> Dict[str, dict]:
        return {doc.id: doc.to_dict() for doc in self._base.collection("concepts").stream()}

    def save_edge(self, source: str, target: str, edge_type: str = "prerequisite") -> None:
        edge_id = f"{source}__{target}"
        self._base.collection("edges").document(edge_id).set({
            "source": source,
            "target": target,
            "type": edge_type,
        })

    def get_all_edges(self) -> List[dict]:
        return [doc.to_dict() for doc in self._base.collection("edges").stream()]

    def delete_concept(self, concept_id: str) -> None:
        self._base.collection("concepts").document(concept_id).delete()

    def delete_edge(self, source: str, target: str) -> None:
        edge_id = f"{source}__{target}"
        self._base.collection("edges").document(edge_id).delete()

    def save_full_graph(self, nodes: Dict[str, dict], edges: List[dict]) -> None:
        """Batch-write the entire graph (used for initial seed or rebuild)."""
        batch = self.db.batch()
        concepts_col = self._base.collection("concepts")
        edges_col = self._base.collection("edges")

        for concept_id, data in nodes.items():
            batch.set(concepts_col.document(concept_id), data)

        for edge in edges:
            edge_id = f"{edge['source']}__{edge['target']}"
            batch.set(edges_col.document(edge_id), edge)

        batch.commit()


# ──────────────────────────────────────────────────────────────────────────────
# BKT Concept State Store (per-student mastery tracking)
# ──────────────────────────────────────────────────────────────────────────────

class FirestoreConceptStateStore:
    """Persist BKT concept states per student to Firestore."""

    def __init__(self, db: FirestoreClient):
        self.db = db

    def save_state(self, student_id: str, concept_id: str, state: dict) -> None:
        """Save a single concept's BKT state."""
        # Convert datetime to ISO string for Firestore
        if "last_updated" in state and isinstance(state["last_updated"], datetime):
            state["last_updated"] = state["last_updated"].isoformat()
        self.db.collection("students").document(student_id) \
            .collection("concept_states").document(concept_id).set(state, merge=True)

    def get_state(self, student_id: str, concept_id: str) -> Optional[dict]:
        doc = self.db.collection("students").document(student_id) \
            .collection("concept_states").document(concept_id).get()
        return doc.to_dict() if doc.exists else None

    def get_all_states(self, student_id: str) -> Dict[str, dict]:
        col = self.db.collection("students").document(student_id).collection("concept_states")
        return {doc.id: doc.to_dict() for doc in col.stream()}
