# app/database/setup.py
import iris
import os
from dotenv import load_dotenv

load_dotenv()

def setup_database():
   """Set up the IRIS database and create necessary tables"""
   print("Setting up database connection...")
   
   username = 'demo'
   password = 'demo'
   hostname = os.getenv('IRIS_HOSTNAME', 'localhost')
   port = '1972'
   namespace = 'USER'
   
   CONNECTION_STRING = f"{hostname}:{port}/{namespace}"
   
   try:
       conn = iris.connect(CONNECTION_STRING, username, password)
       cursor = conn.cursor()
       
       # Drop existing table if it exists
       try:
           cursor.execute("DROP TABLE learning_analytics")
           print("Dropped existing table")
       except:
           print("No existing table to drop")
       
       # Create the table with vector support
       create_table_sql = """
       CREATE TABLE learning_analytics (
           user_id VARCHAR(255),
           topic VARCHAR(255),
           self_confidence INTEGER,
           ai_adjusted_confidence INTEGER,
           errors VARCHAR(500),
           transition_difficulty VARCHAR(50),
           learning_modality VARCHAR(255),
           frustration VARCHAR(10),
           topic_vector VECTOR(DOUBLE, 384)
       )
       """
       
       cursor.execute(create_table_sql)
       print("Created new table")
       
       return conn, cursor
       
   except Exception as e:
       print(f"Error setting up database: {e}")
       raise