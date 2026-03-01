# Yichen — RAG + Socratic Tutor + Interventions

## My Files

| File | Purpose |
|------|---------|
| `app/services/tutor_service.py` | All 5 core functions |
| `app/models/tutor_schemas.py` | Pydantic request/response models |
| `app/main.py` | Endpoints wired at the bottom (search `# Yichen`) |

---

## Running the Backend

```bash
cd /Applications/MAMP/htdocs/dlweekhackathon/backend
uvicorn app.main:app --reload
```

`--reload` watches for file changes and auto-restarts. You do **not** need to manually restart after saving a `.py` file.

---

## After a `git pull`

```bash
cd /Applications/MAMP/htdocs/dlweekhackathon/backend
pip install -r requirements.txt   # only if requirements.txt changed
uvicorn app.main:app --reload      # restart if server was stopped
```

The `--reload` server picks up code changes automatically, but if you pulled new dependencies you must restart it manually.

---

## Running the Frontend

```bash
cd /Applications/MAMP/htdocs/dlweekhackathon/knowledge-network
npm install        # only if package.json changed
npm run dev
```

Runs at **http://localhost:3000**

---

## Environment Setup

Create `backend/.env` (already exists — do not commit this file):

```
OPENAI_API_KEY=sk-...
FIREBASE_SERVICE_ACCOUNT_PATH=path/to/serviceAccountKey.json
FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION=knowledge_chunks
```

---

## My Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tutor/embed` | POST | Chunk + store course content with concept_id tag |
| `/api/tutor/context` | POST | Retrieve relevant chunks for a concept |
| `/api/tutor/chat` | POST | Socratic tutor chat (knowledge-state aware) |
| `/api/tutor/intervene` | POST | Run careless or conceptual intervention |
| `/api/tutor/session-summary` | POST | Generate session stats + LLM highlights |

Interactive docs: **http://localhost:8000/docs**

---

## Testing Pipeline

### 0. Health check

```bash
curl http://localhost:8000/
# → {"message":"LearnGraph AI API is running"}
```

---

### 1. `embed_content` — store course material

```bash
curl -X POST http://localhost:8000/api/tutor/embed \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Newtons Third Law states that for every action there is an equal and opposite reaction. When object A exerts a force on object B, object B exerts an equal force back on A.",
    "concept_id": "newtons-third-law",
    "source": "physics_notes.pdf"
  }'
```

Expected response:
```json
{"chunks_embedded": 1, "concept_id": "newtons-third-law"}
```

---

### 2. `retrieve_context` — pull relevant chunks

```bash
curl -X POST http://localhost:8000/api/tutor/context \
  -H "Content-Type: application/json" \
  -d '{
    "concept": "newtons third law",
    "limit": 3
  }'
```

Expected response:
```json
{
  "concept": "newtons third law",
  "chunks": [
    {"text": "...", "concept_id": "newtons-third-law", "score": 0.75, "chunk_id": "..."}
  ]
}
```

---

### 3. `tutor_chat` — Socratic conversation (basic mode)

```bash
curl -X POST http://localhost:8000/api/tutor/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Why does a rocket move forward in space?",
    "userId": "student_001"
  }'
```

Expected: A **question** back to the student, never a direct answer.

#### With knowledge state (aware mode):

```bash
curl -X POST http://localhost:8000/api/tutor/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Why does a rocket move forward in space?",
    "userId": "student_001",
    "knowledge_state": {
      "userId": "student_001",
      "nodes": [
        {"id": "newtons-third-law", "title": "Newtons Third Law", "mastery": 0.3, "status": "weak"},
        {"id": "momentum", "title": "Momentum", "mastery": 0.7, "status": "learning"}
      ],
      "gaps": [
        {"concept": "Newtons Third Law", "confidenceScore": 30, "priority": "high", "recommendedResources": []}
      ]
    }
  }'
```

Expected: response `mode` is `"socratic_aware"` and questions target weak concepts.

---

### 4a. `run_intervention` — careless mistake

```bash
curl -X POST http://localhost:8000/api/tutor/intervene \
  -H "Content-Type: application/json" \
  -d '{
    "mistake_type": "careless",
    "failed_concept": "momentum",
    "original_question": "Calculate the momentum of a 5kg ball moving at 3 m/s",
    "student_answer": "8 kg·m/s"
  }'
```

Expected:
```json
{
  "intervention_type": "careless",
  "message": "Pattern alert: This type of mistake on 'momentum' often comes from rushing...",
  "scaffolded_questions": ["What exactly does the question ask...", "..."],
  "start_concept": "momentum"
}
```

---

### 4b. `run_intervention` — conceptual mistake

```bash
curl -X POST http://localhost:8000/api/tutor/intervene \
  -H "Content-Type: application/json" \
  -d '{
    "mistake_type": "conceptual",
    "failed_concept": "conservation-of-momentum",
    "original_question": "Two objects collide. Object A (2kg) moves at 4 m/s, Object B (3kg) is stationary. Find final velocity.",
    "prerequisite_chain": {
      "ordered_concepts": ["newtons-third-law", "impulse", "conservation-of-momentum"],
      "failed_concept": "conservation-of-momentum"
    },
    "knowledge_state": {
      "userId": "student_001",
      "nodes": [
        {"id": "newtons-third-law", "title": "Newtons Third Law", "mastery": 0.4, "status": "weak"},
        {"id": "impulse", "title": "Impulse", "mastery": 0.65, "status": "learning"},
        {"id": "conservation-of-momentum", "title": "Conservation of Momentum", "mastery": 0.2, "status": "weak"}
      ],
      "gaps": []
    }
  }'
```

Expected: opener sentence + 3 scaffolded questions starting from `newtons-third-law` (first weak prereq).

---

### 5. `generate_session_summary`

```bash
curl -X POST http://localhost:8000/api/tutor/session-summary \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "student_001",
    "session_start_iso": "2026-03-01T08:00:00",
    "attempts": [
      {"concept": "momentum", "is_correct": true, "mistake_type": null},
      {"concept": "newtons-third-law", "is_correct": false, "mistake_type": "conceptual"},
      {"concept": "momentum", "is_correct": true, "mistake_type": null},
      {"concept": "impulse", "is_correct": false, "mistake_type": "careless"}
    ],
    "prior_mastery_avg": 0.45,
    "current_mastery_avg": 0.58
  }'
```

Expected:
```json
{
  "total_questions": 4,
  "correct": 2,
  "accuracy_pct": 50.0,
  "concepts_practiced": ["momentum", "newtons-third-law", "impulse"],
  "careless_count": 1,
  "conceptual_count": 1,
  "biggest_win": "...",
  "velocity_note": "...",
  "duration_minutes": ...
}
```

---

## Full Integration Flow

```
1. Teacher uploads PDF → POST /upload (stores in Firestore)
2. Tag content by concept → POST /api/tutor/embed
3. Student asks question → POST /api/tutor/chat (with knowledge_state from frontend)
4. Student answers quiz → assessment engine classifies mistake
5. If careless/conceptual → POST /api/tutor/intervene
6. End of session → POST /api/tutor/session-summary
```
