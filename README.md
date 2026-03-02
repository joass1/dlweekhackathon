# Mentora

**AI-powered adaptive learning platform that finds what you don't know you don't know.**

**Live Demo:** [dlweekhackathon-nine.vercel.app](https://dlweekhackathon-nine.vercel.app)

---

## The Problem

Every study tool tracks what students get right or wrong — but none of them can:
- Distinguish a **careless arithmetic slip** from a **deep conceptual misunderstanding**
- Trace a failure on binary search trees back to a **shaky grasp of recursion** three prerequisites down
- Tell a student exactly **what to do with the 30 minutes** they have before an exam

Mentora does all three.

---

## How It Works

### 1. Upload → Knowledge Graph
Upload course material (PDF, TXT, MD). An LLM parses it and constructs a **directed knowledge graph** — concepts and their prerequisite relationships. This becomes the student's living learning map, visualized as an interactive D3 force graph with nodes color-coded by mastery (green/amber/red/gray) and animated prerequisite edges.

### 2. Assessment → Careless vs Conceptual Classification
AI generates diagnostic quizzes **grounded in the student's own material** via RAG retrieval. Before each answer is revealed, students rate their **confidence (1–5)**. An LLM then classifies every wrong answer:
- **Careless** → warning badge, mastery preserved
- **Conceptual** → mastery drops, triggers RPKT

### 3. Recursive Prerequisite Knowledge Tracing (RPKT)
When a conceptual gap is detected, the system walks **backward through the prerequisite chain**, probing at each level until it finds the **knowledge boundary** — the deepest concept where all prerequisites pass but the concept itself fails. These are the student's **unknown unknowns**.

### 4. Study Missions
Enter a time budget (e.g. 25 minutes). The system generates an optimized study queue using a scoring formula:

```
score = gap_severity × prereq_depth × decay_risk × careless_frequency
```

Concepts are filled greedily into the time budget. Each comes with **AI-generated flashcards** from uploaded material. A **Socratic tutor** guides the student through each concept with **micro-checkpoints** every few messages that update mastery in real time.

### 5. Peer Learning Hubs + Boss Battle
A matching algorithm groups students into **balanced peer hubs** where each member's strengths complement others' weaknesses (4-tier snake distribution with complementarity scoring). In a live **video session** (Twilio WebRTC), AI generates one question per member targeting their weakest concept — weakest student leads first (**protégé effect**). Correct answers deal damage to a **shared 3D boss**. All players see the boss HP drop in real time. The session ends when the team defeats it together.

---

## Technical Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, D3.js, React Three Fiber |
| Backend | FastAPI (Python), LangChain |
| Database & Auth | Firebase (Auth + Firestore) |
| AI | OpenAI GPT-5.2 for tutoring, assessment generation, mistake classification, answer evaluation |
| Video | Twilio Video SDK (WebRTC) |
| Deployment | Vercel (frontend), Backend hosted separately |

### Key AI/ML Components
- **Bayesian Knowledge Tracing (BKT)** with exponential decay for mastery estimation
- **LLM-based mistake classification** using confidence calibration + answer analysis
- **Recursive prerequisite graph traversal** (DFS) for root-cause gap detection
- **RAG retrieval** from uploaded course chunks for grounded question generation and tutoring
- **Multi-factor study plan optimization** with greedy knapsack allocation

---

## Local Setup

### Prerequisites
- Node.js 18+, Python 3.10+
- Firebase project with Auth + Firestore enabled
- OpenAI API key
- Twilio account (for peer video sessions)

### 1. Backend
```bash
cd backend
pip install -r requirements.txt
```

Create `backend/.env`:
```
OPENAI_API_KEY=your_key
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
TWILIO_ACCOUNT_SID=your_sid
TWILIO_API_KEY_SID=your_key_sid
TWILIO_API_KEY_SECRET=your_key_secret
```

Start:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend
```bash
cd knowledge-network
npm install
```

Create `knowledge-network/.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

Start:
```bash
npm run dev
```

### 3. Access
- Frontend: `http://localhost:3000`
- Backend API docs: `http://localhost:8000/docs`

---

## Asset Attribution
- Character models sourced from [Quaternius](https://quaternius.com/packs/ultimatemodularcharacters.html)
