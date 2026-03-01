# Assessment + Quiz + Classification API Contract

Base URL: `http://127.0.0.1:8000`

## 1) Generate Quiz
`POST /api/assessment/generate-quiz`

Request:
```json
{
  "student_id": "student-abc",
  "concept": "newtons-laws",
  "num_questions": 5
}
```

Response (excerpt):
```json
{
  "questions": [
    {
      "question_id": "newtons-laws-q1",
      "concept": "newtons-laws",
      "stem": "What happens to acceleration...",
      "options": ["...", "...", "...", "..."],
      "difficulty": "easy"
    }
  ],
  "generation_source": "llm",
  "kg_context": {
    "concept": "newtons-laws",
    "prerequisites": []
  }
}
```

## 2) Evaluate Answers
`POST /api/assessment/evaluate`

Request:
```json
{
  "student_id": "student-abc",
  "concept": "newtons-laws",
  "answers": [
    {
      "question_id": "newtons-laws-q1",
      "selected_answer": "Acceleration doubles",
      "confidence_1_to_5": 4
    }
  ]
}
```

Response:
```json
{
  "score": 80.0,
  "per_question": [
    {
      "question_id": "newtons-laws-q1",
      "is_correct": true,
      "correct_answer": "Acceleration doubles"
    }
  ]
}
```

## 3) Classify Mistakes
`POST /api/assessment/classify`

Request: same payload as evaluate.

Response (excerpt):
```json
{
  "classifications": [
    {
      "question_id": "newtons-laws-q2",
      "mistake_type": "conceptual",
      "missing_concept": "newtons-laws",
      "error_span": "selected option text",
      "rationale": "Low-confidence incorrect answer suggests conceptual gap."
    }
  ],
  "blind_spot_found_count": 2,
  "blind_spot_resolved_count": 1,
  "integration_actions": [
    {
      "question_id": "newtons-laws-q2",
      "mistake_type": "conceptual",
      "rpkt_probe": {
        "concept": "newtons-laws",
        "missing_concept": "newtons-laws"
      },
      "intervention": {
        "mistake_type": "conceptual",
        "concept": "newtons-laws",
        "missing_concept": "newtons-laws"
      }
    }
  ]
}
```

## 4) Self-Awareness Score
`GET /api/assessment/self-awareness/{student_id}`

Response:
```json
{
  "student_id": "student-abc",
  "score": 0.74,
  "total_attempts": 14,
  "calibration_gap": 0.5099
}
```

## 5) Override Classification
`POST /api/assessment/override`

Request:
```json
{
  "student_id": "student-abc",
  "question_id": "newtons-laws-q2",
  "override_to": "careless"
}
```

Response:
```json
{
  "updated": true,
  "question_id": "newtons-laws-q2"
}
```

## 6) Micro-checkpoint
`POST /api/assessment/micro-checkpoint`

Request:
```json
{
  "student_id": "student-abc",
  "concept": "newtons-laws",
  "missing_concept": "forces"
}
```

`POST /api/assessment/micro-checkpoint/submit`

Request:
```json
{
  "student_id": "student-abc",
  "question_id": "checkpoint-forces-123456",
  "selected_answer": "I can explain the concept and apply it to a new problem.",
  "confidence_1_to_5": 3
}
```

Response:
```json
{
  "question_id": "checkpoint-forces-123456",
  "is_correct": true,
  "next_action": "resolved"
}
```

## Integration Notes
- Joash (RPKT/BKT): consume `integration_actions[].rpkt_probe`.
- Yichen (Interventions): consume `integration_actions[].intervention`.
- Seann (Frontend): current API is stable with additive response fields.
