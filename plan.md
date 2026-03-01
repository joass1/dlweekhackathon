# Firebase Integration Plan for LearnGraph AI

## Data That Needs Persistence

Currently hardcoded/mock data that should live in Firebase:

| Data | Current Location | Target |
|------|-----------------|--------|
| User profile (name, major, year) | Hardcoded "John Smith" in Sidebar + Profile | Firestore `users/{uid}` |
| Knowledge graph nodes + edges | Hardcoded 14 nodes in KnowledgeGraph.tsx | Backend `/api/kg/graph` endpoint (already exists) |
| Dashboard stats (mastered, decaying, streak) | Hardcoded in page.tsx | Firestore `users/{uid}` stats |
| Course progress (Data Structures 75%, etc.) | Hardcoded in profile + groups | Firestore `users/{uid}/courses/{courseId}` |
| Study mission concepts | Hardcoded 6 concepts | Backend priority queue + Firestore session log |
| Assessment results | sessionStorage only | Firestore `users/{uid}/assessments/{id}` |
| Student ID | localStorage random string | Firebase Auth UID |
| Auth session | NextAuth GitHub OAuth | Firebase Auth |

## Implementation Phases

### Phase 1: Config Files
- Update root `.gitignore` (add Firebase credentials, service account JSON)
- Update `knowledge-network/.gitignore` (add `.env.local`, exclude `.env.example`)
- Create `knowledge-network/.env.example` with all frontend env vars
- Create `backend/.env.example` with all backend env vars

### Phase 2: Firebase SDK Setup
- `npm install firebase` in knowledge-network
- Create `src/lib/firebase.ts` — Firebase app + Auth + Firestore initialization
- Uses the config the user provided (apiKey, projectId, etc.)
- Store config values directly (Firebase client keys are safe for client-side)

### Phase 3: Auth Context + Replace NextAuth
- Create `src/contexts/AuthContext.tsx` — React context with Firebase Auth
  - Google sign-in + email/password sign-in
  - `useAuth()` hook exposing `user`, `loading`, `signIn`, `signOut`, `signUp`
  - Auto-creates Firestore user doc on first sign-in
- Replace `ClientLayout.tsx` — swap `SessionProvider` with `AuthProvider`
- Create `src/app/login/page.tsx` — sign-in page (Google + email/password)
- Update `Sidebar.tsx` — show real user name/initials from Firebase Auth
- Update `ai-assistant/page.tsx` — replace `useSession()` with `useAuth()`
- Update assessment take page — use Firebase UID instead of localStorage student_id
- Remove `next-auth` dependency and delete `api/auth/[...nextauth]/route.ts`

### Phase 4: Firestore Services
- Create `src/lib/firestore.ts` — CRUD functions:
  - `getUserProfile(uid)` / `updateUserProfile(uid, data)`
  - `getUserCourses(uid)` / `updateCourseProgress(uid, courseId, data)`
  - `saveAssessmentResult(uid, result)` / `getAssessmentResults(uid)`
  - `saveStudySession(uid, session)` / `getStudyStreak(uid)`
  - `getDashboardStats(uid)` — computed from courses + knowledge graph

### Phase 5: Connect Pages to Firestore
- **Dashboard** (`page.tsx`) — fetch stats from Firestore, show real mastery counts
- **KnowledgeGraph** — fetch from backend `/api/kg/graph` instead of hardcoded nodes
- **Knowledge Map** — same, compute stats from fetched data
- **Profile** — load user profile + course progress from Firestore
- **Groups** — load user's enrolled courses from Firestore
- **Study Mission** — fetch priority concepts from backend, log completed sessions
- **Assessment take** — save results to Firestore after submission

### Phase 6: Build & Verify
- Run `npm run build` to verify no errors
- Ensure all pages compile correctly
