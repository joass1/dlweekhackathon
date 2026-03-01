from sentence_transformers import SentenceTransformer

class VectorSearch:
    def __init__(self, cursor):
        self.cursor = cursor
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
    
    def search_discussions(self, query: str, limit: int = 5):
        search_vector = self.model.encode(query, normalize_embeddings=True).tolist()
        
        sql = """
            SELECT TOP ? 
                student_name,
                topic,
                discussion,
                VECTOR_DOT_PRODUCT(discussion_vector, TO_VECTOR(?)) as similarity
            FROM student_discussions
            ORDER BY similarity DESC
        """
        
        self.cursor.execute(sql, [limit, str(search_vector)])
        results = self.cursor.fetchall()
        
        return [
            {
                "student": row[0],
                "topic": row[1],
                "discussion": row[2],
                "similarity": float(row[3])
            }
            for row in results
        ]