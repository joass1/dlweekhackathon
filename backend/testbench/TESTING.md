# Assessment Module Testing

## Prerequisites
- Python 3.10+
- Backend dependencies installed

## Run Unit Tests
From `backend/`:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

## Run API Locally
```bash
uvicorn app.main:app --reload
```

Open Swagger:
- `http://127.0.0.1:8000/docs`

## Manual Verification Flow
1. Call `/api/assessment/generate-quiz`
2. Submit answers to `/api/assessment/evaluate`
3. Submit same payload to `/api/assessment/classify`
4. Check `/api/assessment/self-awareness/{student_id}`
5. If conceptual mistake exists, call `/api/assessment/override`
6. Run `/api/assessment/micro-checkpoint` and `/submit`

## Persistence Check
After several calls, verify file exists:

`backend/data/assessment_state.json`

Restart server and confirm previous attempts still affect self-awareness score.
