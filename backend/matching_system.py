from openai import OpenAI
from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

class MatchingSystem:
    def __init__(self):
        self.client = OpenAI(
            api_key=os.getenv('SONAR_API_KEY'),
            base_url="https://api.perplexity.ai"
        )
        self.supabase = create_client(
            os.getenv('SUPABASE_URL'),
            os.getenv('SUPABASE_KEY')
        )

    def get_all_nodes_with_scores(self):
        # Get all nodes and their scores
        nodes = self.supabase.table('nodes').select('*').execute()
        formatted_nodes = []
        
        for node in nodes.data:
            scores = self.supabase.table('knowledge_scores')\
                .select('*')\
                .eq('node_id', node['id'])\
                .execute()
            
            if scores.data:
                node_data = {
                    'id': node['id'],
                    'student_name': node['student_name'],
                    'hub_id': node['hub_id'],
                    'scores': {
                        'comprehension': scores.data[0]['comprehension_score'],
                        'implementation': scores.data[0]['implementation_score'],
                        'integration': scores.data[0]['integration_score']
                    }
                }
                formatted_nodes.append(node_data)
        
        return formatted_nodes

    def get_matches(self):
        nodes_data = self.get_all_nodes_with_scores()
        
        # Prepare the message for Sonar
        messages = [
    {
        "role": "system",
        "content": (
            "You are an AI specializing in educational matching. You must match ALL students "
            "into pairs, ensuring no student is left unmatched. Create exactly 8 pairs from "
            "the 16 students, optimizing for knowledge transfer while ensuring everyone is included."
        )
    },
    {
        "role": "user",
        "content": (
            f"Here are the 16 students with their scores: {str(nodes_data)}. "
            "Please create EXACTLY 8 pairs, including ALL students, based on these criteria:\n"
            "1. Match students with significant score differences\n"
            "2. Consider all three scores (comprehension, implementation, integration)\n"
            "3. Prioritize larger gaps for better knowledge transfer\n"
            "4. Try to match across different hubs when beneficial\n"
            "5. Ensure NO student is left unmatched\n"
            "Return ALL 8 pairs with explanations for each match."
        )
    }
]

        try:
            response = self.client.chat.completions.create(
                model="sonar-pro",
                messages=messages
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"Error getting matches: {str(e)}")
            return None

def test_matching():
    matcher = MatchingSystem()
    print("\n=== CURRENT NETWORK DATA ===")
    nodes = matcher.get_all_nodes_with_scores()
    for node in nodes:
        print(f"\nStudent: {node['student_name']}")
        print(f"Scores: {node['scores']}")
    
    print("\n=== SUGGESTED MATCHES ===")
    matches = matcher.get_matches()
    print(matches)

if __name__ == "__main__":
    test_matching()