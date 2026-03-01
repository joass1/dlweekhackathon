# app/scripts/prepare_data.py
import pandas as pd
from sentence_transformers import SentenceTransformer
import os
from pathlib import Path

def combine_and_prepare_data():
    # Get the project root directory
    project_root = Path(__file__).parent.parent.parent
    data_dir = project_root / 'data'
    
    # Your CSV files
    csv_files = [
        'studentdiscussion1.csv',
        'studentdiscussion2.csv',
        'studentdiscussion3.csv',
        'studentdiscussion4.csv',
        'studentdiscussion5.csv'
    ]
    
    dfs = []
    for file in csv_files:
        file_path = data_dir / file
        print(f"Reading file: {file_path}")  # Debug print
        df = pd.read_csv(file_path)
        dfs.append(df)
    
    combined_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows in combined dataset: {len(combined_df)}")
    
    model = SentenceTransformer('all-MiniLM-L6-v2')
    # Use the correct case 'Discussion'
    combined_df['discussion_vector'] = combined_df['Discussion'].apply(
        lambda x: model.encode(x, normalize_embeddings=True).tolist()
    )
    
    return combined_df

def insert_data(cursor, df):
    """Insert the prepared data into IRIS database"""
    print("Starting data insertion...")
    
    sql = """
        INSERT INTO student_discussions
        (student_name, topic, discussion, discussion_vector)
        VALUES (?, ?, ?, TO_VECTOR(?))
    """
    
    for index, row in df.iterrows():
        try:
            data = [
                row['Student'],  # Correct case
                row['Topic'],    # Correct case
                row['Discussion'], # Correct case
                str(row['discussion_vector'])
            ]
            cursor.execute(sql, data)
            
            if index % 100 == 0:
                print(f"Inserted {index + 1} rows...")
                
        except Exception as e:
            print(f"Error inserting row {index}: {e}")
            print(f"Row data: {row}")
            raise
    
    print(f"Successfully inserted {len(df)} rows into the database")