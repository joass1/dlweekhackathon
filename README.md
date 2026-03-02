# Mentora

Mentora is an adaptive learning web app with:
- course material upload and concept extraction
- personalized knowledge graph / knowledge map
- Socratic Tutor with context-aware responses
- assessment and checkpoint flows
- peer hubs with collaborative sessions and Twilio video token support
- Firebase-backed auth and storage

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
