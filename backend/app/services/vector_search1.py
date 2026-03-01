from sentence_transformers import SentenceTransformer
from typing import List, Dict
import numpy as np

class VectorSearch1:
    def __init__(self, cursor):
        self.cursor = cursor
        self.model = SentenceTransformer('all-MiniLM-L6-v2')

    def cluster_similar_learners(self, group_size: int = 4) -> List[List[Dict]]:
        # First, get all learners and their vectors
        sql = """
            SELECT 
                user_id,
                topic,
                self_confidence,
                ai_adjusted_confidence,
                errors,
                transition_difficulty, 
                learning_modality,
                frustration,
                topic_vector
            FROM learning_analytics
        """
        
        self.cursor.execute(sql)
        results = self.cursor.fetchall()
        
        # Convert results to vectors for comparison
        learners = []
        for row in results:
            learner = {
                "user_id": row[0],
                "topic": row[1],
                "self_confidence": row[2],
                "ai_adjusted_confidence": row[3],
                "errors": row[4],
                "transition_difficulty": row[5],
                "learning_modality": row[6],
                "frustration": row[7],
                "vector": eval(row[8])  # Convert string vector back to list
            }
            learners.append(learner)

        # Group formation algorithm
        groups = []
        remaining_learners = learners.copy()
        
        while len(remaining_learners) >= group_size:
            # Start a new group with first remaining learner
            current_group = [remaining_learners[0]]
            remaining_learners.pop(0)
            
            # Find most similar learners for the group
            while len(current_group) < group_size and remaining_learners:
                # Calculate average vector of current group
                group_vector = np.mean([l["vector"] for l in current_group], axis=0)
                
                # Find most similar remaining learner
                max_similarity = -1
                most_similar_idx = -1
                
                for i, learner in enumerate(remaining_learners):
                    similarity = np.dot(group_vector, learner["vector"]) / (
                        np.linalg.norm(group_vector) * np.linalg.norm(learner["vector"])
                    )
                    
                    if similarity > max_similarity:
                        max_similarity = similarity
                        most_similar_idx = i
                
                # Add most similar learner to group
                current_group.append(remaining_learners.pop(most_similar_idx))
            
            # Add completed group
            groups.append([{
                "user_id": l["user_id"],
                "topic": l["topic"],
                "self_confidence": l["self_confidence"],
                "ai_adjusted_confidence": l["ai_adjusted_confidence"],
                "errors": l["errors"],
                "transition_difficulty": l["transition_difficulty"],
                "learning_modality": l["learning_modality"],
                "frustration": l["frustration"]
            } for l in current_group])

        return groups

   