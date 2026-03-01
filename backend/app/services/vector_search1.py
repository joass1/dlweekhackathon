import os
from math import ceil
from typing import Dict, List

import numpy as np
from dotenv import load_dotenv

load_dotenv()


class VectorSearch1:
    def __init__(self, db):
        self.db = db
        self.collection_name = os.getenv("FIREBASE_LEARNING_ANALYTICS_COLLECTION", "learning_analytics")

    @staticmethod
    def _to_float(value, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def cluster_similar_learners(self, group_size: int = 4) -> List[List[Dict]]:
        if self.db is None:
            raise RuntimeError("Firestore is not initialized")

        docs = list(self.db.collection(self.collection_name).stream())
        learners: List[Dict] = []
        for doc in docs:
            row = doc.to_dict() or {}
            learners.append(
                {
                    "user_id": row.get("user_id", doc.id),
                    "topic": row.get("topic", ""),
                    "self_confidence": row.get("self_confidence"),
                    "ai_adjusted_confidence": row.get("ai_adjusted_confidence"),
                    "errors": row.get("errors"),
                    "transition_difficulty": row.get("transition_difficulty"),
                    "learning_modality": row.get("learning_modality"),
                    "frustration": row.get("frustration"),
                    "vector": row.get("topic_vector", []),
                }
            )

        if not learners:
            return []

        group_size = max(2, group_size)

        # If vectors exist, group by cosine similarity greedily.
        has_vectors = any(isinstance(l.get("vector"), list) and len(l["vector"]) > 0 for l in learners)
        if has_vectors:
            remaining = learners.copy()
            groups: List[List[Dict]] = []
            while remaining:
                current = [remaining.pop(0)]
                while len(current) < group_size and remaining:
                    valid_vectors = [l["vector"] for l in current if isinstance(l.get("vector"), list) and l["vector"]]
                    if not valid_vectors:
                        current.append(remaining.pop(0))
                        continue
                    group_vector = np.mean(valid_vectors, axis=0)
                    best_idx = 0
                    best_score = -2.0
                    for i, candidate in enumerate(remaining):
                        vec = candidate.get("vector")
                        if not isinstance(vec, list) or not vec:
                            score = -1.0
                        else:
                            a = np.array(group_vector)
                            b = np.array(vec)
                            denom = float(np.linalg.norm(a) * np.linalg.norm(b))
                            score = float(np.dot(a, b) / denom) if denom > 0 else -1.0
                        if score > best_score:
                            best_score = score
                            best_idx = i
                    current.append(remaining.pop(best_idx))
                groups.append([
                    {
                        "user_id": l["user_id"],
                        "topic": l["topic"],
                        "self_confidence": l["self_confidence"],
                        "ai_adjusted_confidence": l["ai_adjusted_confidence"],
                        "errors": l["errors"],
                        "transition_difficulty": l["transition_difficulty"],
                        "learning_modality": l["learning_modality"],
                        "frustration": l["frustration"],
                    }
                    for l in current
                ])
            return groups

        # Fallback grouping without vectors: snake-distribute by adjusted confidence.
        sorted_learners = sorted(
            learners,
            key=lambda x: self._to_float(x.get("ai_adjusted_confidence"), 0.0),
            reverse=True,
        )
        num_groups = max(1, ceil(len(sorted_learners) / group_size))
        groups: List[List[Dict]] = [[] for _ in range(num_groups)]

        idx = 0
        direction = 1
        for learner in sorted_learners:
            groups[idx].append(
                {
                    "user_id": learner["user_id"],
                    "topic": learner["topic"],
                    "self_confidence": learner["self_confidence"],
                    "ai_adjusted_confidence": learner["ai_adjusted_confidence"],
                    "errors": learner["errors"],
                    "transition_difficulty": learner["transition_difficulty"],
                    "learning_modality": learner["learning_modality"],
                    "frustration": learner["frustration"],
                }
            )
            idx += direction
            if idx >= num_groups:
                idx = num_groups - 1
                direction = -1
            elif idx < 0:
                idx = 0
                direction = 1

        return [g for g in groups if g]
