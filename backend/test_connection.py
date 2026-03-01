from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

def test_supabase_connection():
    try:
        # Initialize Supabase client
        supabase = create_client(
            os.getenv('SUPABASE_URL'),
            os.getenv('SUPABASE_KEY')
        )
        
        # Try to fetch from hubs table
        response = supabase.table('hubs').select("*").execute()
        print("Connection successful!")
        print(f"Number of hubs found: {len(response.data)}")
        return True
        
    except Exception as e:
        print(f"Connection failed: {str(e)}")
        return False

if __name__ == "__main__":
    test_supabase_connection()