# Mentora

Mentora is an adaptive learning web app that turns uploaded study materials into a personalized knowledge graph, then uses that graph to drive tutoring, assessments, study missions, and collaborative peer sessions.

## Product Overview
Mentora is designed to help students learn more effectively by:
- building a personal concept graph from their own materials
- identifying weak concepts and prerequisite gaps
- guiding understanding through Socratic tutoring
- running targeted assessments and checkpoints
- supporting collaborative learning in Peer Hubs

## Implemented Features
- Authentication and user-scoped data
  - Firebase auth integration
  - per-user courses, topics, progress, and graph context
- Upload Materials
  - upload PDF/TXT/MD content
  - chunking + concept extraction
  - user/course-aware knowledge graph updates
  - add new courses from the upload flow
- Knowledge Map
  - interactive concept graph visualization
  - concept mastery/state representation
  - bubble actions route to Assessment, Socratic Tutor, and Peer Hubs
- Socratic Tutor
  - context-aware tutoring flow
  - citation-aware responses and checkpoint hooks
  - 3D character scene with speech bubble UI
- Assessments
  - generate quiz from user knowledge context
  - evaluate/classify answers
  - micro-checkpoints, mastery updates, and assessment history
- Study Missions
  - study chunks and flashcard generation
  - weak/decaying concept targeting
- Peer Hubs
  - collaborative session creation/joining
  - AI-generated question rounds
  - boss battle UI with animated 3D boss state (idle/hit/death + periodic attacks)
  - video room token endpoint for WebRTC sessions
- Progress
  - aggregated learner progress from assessment and graph signals

## Stack
- Frontend: Next.js 15, React 19, TypeScript, Tailwind
- Backend: FastAPI (Python)
- Data/Auth: Firebase (Auth + Firestore + Storage)
- AI: OpenAI-backed tutoring and assessment generation

## Repository Layout
- `knowledge-network/`: Next.js frontend
- `backend/`: FastAPI backend

## Local Setup
1. Frontend env:
   - create `knowledge-network/.env.local`
   - set:
     - `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
     - `NEXT_PUBLIC_FIREBASE_API_KEY=...`
     - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...`
     - `NEXT_PUBLIC_FIREBASE_PROJECT_ID=...`
     - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...`
     - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...`
     - `NEXT_PUBLIC_FIREBASE_APP_ID=...`
2. Backend env:
   - use `backend/.env`
   - set:
     - `FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json`
     - `OPENAI_API_KEY=...`
     - `TWILIO_ACCOUNT_SID=...`
     - `TWILIO_API_KEY_SID=...`
     - `TWILIO_API_KEY_SECRET=...`

## Run
1. Start backend:
```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
2. Start frontend:
```bash
cd knowledge-network
npm install
npm run dev
```
3. Open:
   - frontend: `http://localhost:3000`
   - backend docs: `http://localhost:8000/docs`

## Build
```bash
cd knowledge-network
npm run build
```

## Notes
- Firebase and OpenAI are required for the core app flows.
- Peer video session token endpoint requires Twilio credentials in backend env.

## Asset Attribution
- Character models are sourced from Quaternius:
  - https://quaternius.com/packs/ultimatemodularcharacters.html
