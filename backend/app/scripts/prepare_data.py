import pandas as pd
from sentence_transformers import SentenceTransformer
from pathlib import Path


def combine_and_prepare_data():
    project_root = Path(__file__).parent.parent.parent
    data_dir = project_root / "data"

    csv_files = [
        "studentdiscussion1.csv",
        "studentdiscussion2.csv",
        "studentdiscussion3.csv",
        "studentdiscussion4.csv",
        "studentdiscussion5.csv",
    ]

    dfs = []
    for file in csv_files:
        file_path = data_dir / file
        print(f"Reading file: {file_path}")
        df = pd.read_csv(file_path)
        dfs.append(df)

    combined_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows in combined dataset: {len(combined_df)}")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    combined_df["discussion_vector"] = combined_df["Discussion"].apply(
        lambda x: model.encode(x, normalize_embeddings=True).tolist()
    )

    return combined_df


def insert_data(db, df):
    """Insert prepared discussion data into Firestore knowledge_chunks collection."""
    print("Starting Firestore insertion...")
    batch = db.batch()
    count = 0

    for index, row in df.iterrows():
        try:
            doc_ref = db.collection("knowledge_chunks").document()
            batch.set(
                doc_ref,
                {
                    "student": row["Student"],
                    "source": row["Topic"],
                    "text": row["Discussion"],
                    "discussion_vector": row["discussion_vector"],
                    "chunk_index": int(index),
                },
            )
            count += 1

            if count % 400 == 0:
                batch.commit()
                batch = db.batch()
                print(f"Inserted {count} rows...")

        except Exception as e:
            print(f"Error inserting row {index}: {e}")
            raise

    if count % 400 != 0:
        batch.commit()

    print(f"Successfully inserted {count} rows into Firestore")
