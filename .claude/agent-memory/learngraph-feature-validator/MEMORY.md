# LearnGraph Feature Validator - Agent Memory

## Project Architecture
- **Frontend**: Next.js 15.1.7 + React 19, TypeScript, Tailwind, Firebase Auth
- **Backend**: Python FastAPI + OpenAI (gpt-5.2), Firestore, Sentence Transformers
- **3D**: Three.js + React Three Fiber for Socratic character

## Key File Paths
- AI Assistant page: `knowledge-network/src/app/ai-assistant/page.tsx`
- Chat components: `knowledge-network/src/components/ai/` (ChatWindow, ChatInput, SocraticBackground3D, NotesContext, SubjectsList)
- API proxy: `knowledge-network/src/app/api/ai/chat/route.ts` → FastAPI `/api/tutor/chat`
- Tutor service: `backend/app/services/tutor_service.py`
- Knowledge graph: `backend/app/services/knowledge_graph.py`
- Adaptive engine (BKT/RPKT): `backend/app/services/adaptive_engine.py`
- Assessment engine: `backend/app/services/assessment_engine.py`
- Schemas: `backend/app/models/tutor_schemas.py`, `adaptive_schemas.py`

## Known Issues (as of 2026-03-02)
- **knowledge_state NOT sent from AI assistant page** → Socratic mode degrades to generic prompts
- Upload flow creates chunks but does NOT construct prerequisite graph edges
- `/api/tutor/intervene` endpoint exists but is NOT wired to AI assistant page
- Session summary endpoint exists but no "end session" trigger on AI assistant page

## Key Patterns
- RAG retrieval is user-scoped via `userId` filter on Firestore queries
- Citations: backend assigns 1-based indices → LLM uses [N] markers → frontend parses via regex
- Speech bubble in 3D uses `@react-three/drei` `<Html>` component — needs `pointer-events: auto` on the Html style prop for scroll/click to work (parent canvas div is pointer-events-none)
- `overscroll-contain` on scrollable elements prevents scroll chaining to parent

## Validated Features
- [x] RAG retrieval with user-scoping
- [x] Socratic vs Content-Aware mode toggle
- [x] Citation chain (LLM → bubble → sidebar highlight)
- [x] Content upload with course organization
- [x] Careless vs conceptual intervention logic (backend only)
- [x] Session summary with mastery velocity (backend only)
