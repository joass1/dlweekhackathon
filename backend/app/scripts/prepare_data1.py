import pandas as pd
from sentence_transformers import SentenceTransformer
from pathlib import Path


def prepare_learning_analytics():
    project_root = Path(__file__).parent.parent.parent
    data_dir = project_root / "data"

    csv_files = ["learning1.csv", "learning2.csv", "learning3.csv", "learning4.csv", "learning5.csv"]

    dfs = []
    for file in csv_files:
        file_path = data_dir / file
        print(f"Reading file: {file_path}")
        df = pd.read_csv(file_path)
        dfs.append(df)

    combined_df = pd.concat(dfs, ignore_index=True)
    print(f"Total rows in combined dataset: {len(combined_df)}")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    combined_df["topic_vector"] = combined_df["Topic"].apply(
        lambda x: model.encode(x, normalize_embeddings=True).tolist()
    )

    return combined_df


def insert_learning_analytics(db, df):
    """Insert learning analytics into Firestore learning_analytics collection."""
    print("Starting Firestore insertion...")
    batch = db.batch()
    count = 0

    for index, row in df.iterrows():
        try:
            doc_ref = db.collection("learning_analytics").document()
            batch.set(
                doc_ref,
                {
                    "user_id": row["User_ID"],
                    "topic": row["Topic"],
                    "self_confidence": row["Self-Confidence"],
                    "ai_adjusted_confidence": row["AI-Adjusted Confidence"],
                    "errors": row["Errors"],
                    "transition_difficulty": row["Transition Difficulty"],
                    "learning_modality": row["Learning Modality"],
                    "frustration": row["Frustration"],
                    "topic_vector": row["topic_vector"],
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
