# app/scripts/prepare_data.py
import pandas as pd
from sentence_transformers import SentenceTransformer
import os
from pathlib import Path

def prepare_learning_analytics():
    # Get the project root directory
    project_root = Path(__file__).parent.parent.parent
    data_dir = project_root / 'data'
    
    # Your CSV files
    csv_files = [
        'learning1.csv',
        'learning2.csv',
        'learning3.csv',
        'learning4.csv',
        'learning5.csv'
    ]
    
    dfs = []
    for file in csv_files:
        file_path = data_dir / file
        print(f"Reading file: {file_path}")  # Debug print
        df = pd.read_csv(file_path)
        dfs.append(df)
    
    combined_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows in combined dataset: {len(combined_df)}")
    
    # Create embeddings for topics
    model = SentenceTransformer('all-MiniLM-L6-v2')
    combined_df['topic_vector'] = combined_df['Topic'].apply(
        lambda x: model.encode(x, normalize_embeddings=True).tolist()
    )
    
    return combined_df

def insert_learning_analytics(cursor, df):
    """Insert the learning analytics data into IRIS database"""
    print("Starting data insertion...")
    
    sql = """
        INSERT INTO learning_analytics
        (user_id, topic, self_confidence, ai_adjusted_confidence, 
         errors, transition_difficulty, learning_modality, 
         frustration, topic_vector)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?))
    """
    
    for index, row in df.iterrows():
        try:
            data = [
                row['User_ID'],
                row['Topic'],
                row['Self-Confidence'],
                row['AI-Adjusted Confidence'],
                row['Errors'],
                row['Transition Difficulty'],
                row['Learning Modality'],
                row['Frustration'],
                str(row['topic_vector'])
            ]
            cursor.execute(sql, data)
            
            if index % 100 == 0:
                print(f"Inserted {index + 1} rows...")
                
        except Exception as e:
            print(f"Error inserting row {index}: {e}")
            print(f"Row data: {row}")
            raise
    
    print(f"Successfully inserted {len(df)} rows into the database")