from openai import OpenAI
from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

class HubCreator:
    def __init__(self):
        self.client = OpenAI(
            api_key=os.getenv('SONAR_API_KEY'),
            base_url="https://api.perplexity.ai"
        )
        self.supabase = create_client(
            os.getenv('SUPABASE_URL'),
            os.getenv('SUPABASE_KEY')
        )

    def get_student_data(self):
        # Get all students with their scores
        students = self.supabase.table('students').select('*').execute()
        formatted_students = []
        
        for student in students.data:
            scores = self.supabase.table('assessment_results')\
                .select('*')\
                .eq('student_id', student['id'])\
                .execute()
            
            if scores.data:
                student_data = {
                    'id': student['id'],
                    'name': student['name'],
                    'scores': {
                        'comprehension': scores.data[0]['comprehension_score'],
                        'implementation': scores.data[0]['implementation_score'],
                        'integration': scores.data[0]['integration_score']
                    }
                }
                formatted_students.append(student_data)
        
        return formatted_students

    def get_hub_suggestions(self):
        students_data = self.get_student_data()
        
        messages = [
            {
                "role": "system",
                "content": "You are an AI specializing in creating balanced learning groups. Your task is to organize students into optimal groups of 4 that can collectively achieve high performance through knowledge sharing."
            },
            {
                "role": "user",
                "content": f"""
                Here are 16 students with their scores: {str(students_data)}
                Create 4 balanced hubs of 4 students each where:
                1. Each hub should have a mix of strong and developing students
                2. Each hub should have potential to improve through internal knowledge sharing
                3. All hubs should be competitively balanced with each other
                4. Focus on creating groups where students can help each other improve
                5. Consider all three scores (comprehension, implementation, integration)
                
                Return the 4 hubs with explanations for why each group would work well together.
                Format the response clearly showing each hub's composition and reasoning.
                """
            }
        ]

        try:
            response = self.client.chat.completions.create(
                model="sonar-pro",
                messages=messages
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"Error getting hub suggestions: {str(e)}")
            return None

def test_hub_creation():
    creator = HubCreator()
    print("\n=== CURRENT STUDENT DATA ===")
    students = creator.get_student_data()
    for student in students:
        print(f"\nStudent: {student['name']}")
        print(f"Scores: {student['scores']}")
    
    print("\n=== SUGGESTED HUB ASSIGNMENTS ===")
    suggestions = creator.get_hub_suggestions()
    print(suggestions)

if __name__ == "__main__":
    test_hub_creation()