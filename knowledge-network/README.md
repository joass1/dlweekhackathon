# Mentora

Mentora is an adaptive learning workspace that turns uploaded course material into a guided study loop:

- diagnose what the student does and does not understand
- recommend what to study next and explain why
- coach with a Socratic tutor instead of just giving answers
- reinforce with study missions, flashcards, and follow-up assessments
- support peer learning through study groups and live sessions

## What Problem It Solves

Most learning tools either stop at content storage or generate generic AI answers. Mentora is built to close the loop between:

- uploaded course material
- knowledge graph state
- assessment mistakes
- confidence calibration
- study planning
- tutoring

The goal is not "more AI". The goal is better learning decisions.

## Core Product Flow

1. Upload course material.
2. Build or refresh the learner's knowledge graph.
3. Detect weak, learning, and mastered concepts.
4. Recommend the next best action on the dashboard.
5. Generate a time-bounded Study Mission.
6. Reinforce with flashcards and reflection checks.
7. Send the learner to assessment.
8. Feed new mistakes and confidence data back into the graph.

## Why The Product Stands Out

### 1. Recommendations are explainable

Mentora does not only say what to study next. It now shows the signals behind that recommendation:

- mastery gap
- prerequisite impact
- decay risk
- careless mistake frequency
- ROI per minute in Study Mission mode

This makes the system easier to trust and easier to challenge.

### 2. Responsible AI is visible in the product

The Socratic Tutor is designed to be evidence-aware rather than answer-spamming:

- cited responses point back to retrieved source chunks
- the source panel shows the supporting evidence
- the UI warns users when claims should be treated as tentative
- failures are surfaced to the user instead of silently disappearing

### 3. The product degrades gracefully

Hackathon projects often look good only when every service is online. Mentora now handles more failure cases directly in the UI:

- partial dashboard data failures show transparent warnings instead of blank states
- if the adaptive planner is unavailable, Study Mission falls back to a local heuristic planner
- if AI flashcard generation fails, concept-based fallback flashcards are still generated
- empty states point users to the next meaningful action instead of dead-ending

This matters because "fool proof" is not only about the happy path. It is about staying useful when the backend is imperfect.

## Responsible AI Design Choices

Mentora should help students think better, not outsource thinking.

Current product safeguards:

- Socratic guidance instead of direct answer dumping where possible
- visible source grounding and citation navigation
- confidence-aware checkpoints
- "confidence trap" reflection for careless-error concepts
- transparent explanation of why a recommendation was made
- explicit fallback messaging when an AI service is unavailable

What this means in practice:

- recommendations are advisory, not treated as grades
- students can inspect supporting evidence
- the system distinguishes between conceptual gaps and careless mistakes
- the product keeps working even if one AI subsystem fails

## Main Surfaces In This Repo

- `src/app/page.tsx`: student dashboard and next-best-action recommendations
- `src/app/study-mission/page.tsx`: time-boxed mission planner, flashcards, and review workflow
- `src/app/assessment/page.tsx`: assessment selection and history
- `src/app/ai-assistant/page.tsx`: Socratic tutor experience
- `src/app/groups/page.tsx`: peer learning hubs

## Local Development

Requirements:

- Node.js 18+
- npm
- a running backend that exposes the expected API routes

Install and run:

```bash
npm install
npm run dev
```

By default the frontend expects the backend at:

```bash
http://127.0.0.1:8000
```

You can override that with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://your-backend-host:8000
```

The dashboard recommendation route in this frontend proxies to the backend tutor
service. The AI key should therefore live in the backend environment, not this
Next.js app.

## Judge-Facing Summary

Mentora fulfills its purpose because it does not stop at identifying weak topics. It turns diagnosis into action:

- it identifies what needs work
- explains why that recommendation exists
- helps the student study it
- checks understanding again
- updates future recommendations from the result

That closed loop is the product.
