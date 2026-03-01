from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_KEY')
)

def view_network_data():
    # Get all hubs with their nodes
    print("\n=== NETWORK OVERVIEW ===")
    hubs = supabase.table('hubs').select('*').execute()
    
    for hub in hubs.data:
        print(f"\nHUB: {hub['hub_name']}")
        
        # Get nodes in this hub
        nodes = supabase.table('nodes')\
            .select('*')\
            .eq('hub_id', hub['id'])\
            .execute()
            
        # Get scores for each node
        for node in nodes.data:
            scores = supabase.table('knowledge_scores')\
                .select('*')\
                .eq('node_id', node['id'])\
                .execute()
                
            print(f"\nStudent: {node['student_name']}")
            if scores.data:
                score = scores.data[0]
                print(f"Scores:")
                print(f"- Comprehension: {score['comprehension_score']}")
                print(f"- Implementation: {score['implementation_score']}")
                print(f"- Integration: {score['integration_score']}")

if __name__ == "__main__":
    view_network_data()