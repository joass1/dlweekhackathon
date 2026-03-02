# Yichen's Implementation: Mentora AI Tutor — Problems 1–12

Scope: `backend/app/services/tutor_service.py`, `backend/app/main.py`, and the AI assistant UI components under `knowledge-network/src/components/ai/` and `knowledge-network/src/app/ai-assistant/`.

---

## Problem 1 — Content Embedding & Upload Pipeline

### What was built
A text-chunking and Firestore storage pipeline so uploaded course materials become queryable chunks.

### Backend
**`backend/app/services/tutor_service.py` — `embed_content()`**
- Splits raw text into 500-char chunks with 50-char overlap using `CharacterTextSplitter`.
- Writes each chunk to the `knowledge_chunks` Firestore collection with fields: `text`, `concept_id`, `source`, `chunk_index`, `userId`, `created_at`.
- Returns the total number of chunks stored.

**`backend/app/main.py` — `POST /upload`**
- Accepts one or more `UploadFile` objects plus `course_id` / `course_name` form fields.
- Supports `.pdf`, `.txt`, `.md` via LangChain `PyPDFLoader` / `TextLoader`.
- Writes chunks to Firestore via `batch.commit()`.
- Upserts course metadata to `users/{uid}/courses/{courseId}`.
- Writes a `user_topics` document (courseId, courseName, conceptId, title, chunkCount) for sidebar visibility.
- Triggers KG build from extracted text (`user_kg_engine.build_from_material()`).
- Returns per-file `{filename, chunks, status, error?}` array.

**`backend/app/main.py` — `GET /api/courses`, `POST /api/courses`**
- `GET /api/courses`: streams user's course sub-collection, returns sorted `[{id, name}]`.
- `POST /api/courses`: creates or no-ops a course document in `users/{uid}/courses/{courseId}`.

**`backend/app/main.py` — `POST /api/tutor/embed`**
- Direct embed endpoint (bypasses file parsing) — takes `content` string + `concept_id`, calls `embed_content()`.

---

## Problem 2 — RAG Retrieval & Basic Socratic Chat

### What was built
A keyword-overlap retrieval system and the first working `/api/tutor/chat` endpoint.

### Backend
**`backend/app/services/tutor_service.py` — `retrieve_context()`**
- Queries `knowledge_chunks` filtered by `concept_ids` (in-clause) or `userId`, scanning up to 300 docs.
- Scores each chunk by the fraction of meaningful query tokens present in the chunk text.
- Deduplicates chunks by text hash.
- Returns top-N scored chunks as `[{text, concept_id, score, chunk_id}]`.

**`backend/app/services/tutor_service.py` — `tutor_chat()` (initial version)**
- Retrieves context chunks for the query.
- Formats context and calls OpenAI `gpt-5.2` with Socratic system prompt.
- Returns `{answer, context, mode}`.

**`backend/app/main.py` — `POST /api/tutor/chat`**
- Validates `query` field, calls `tutor_service.tutor_chat()` with `student_id`, `knowledge_state`, `concept_ids`, `mode`.

**`backend/app/main.py` — `POST /api/tutor/context`**
- Debug/test endpoint — directly returns retrieved context chunks for a concept query.

---

## Problem 3 — Socratic / Content-Aware Mode Toggle

### What was built
A toggle switch that changes the AI persona between guided Socratic questioning and direct content-grounded answers.

### Backend
**`backend/app/models/tutor_schemas.py`** — added `mode: str = "socratic"` to `TutorChatRequest`.

**`backend/app/services/tutor_service.py`**
- `_build_socratic_prompt(knowledge_state)`: Mentora as a warm Socratic tutor. Instructs: explain first, then ask ONE follow-up question, never respond with only a question. Integrates weak-concept data if `knowledge_state` is provided.
- `_build_content_aware_prompt()`: Mentora as a precise Study Companion. Rules: answer directly, cite sources with `[N]`, supplement with general knowledge if context is partial, never refuse just because context is incomplete. (See also Problem 12 for citation enhancement.)
- `tutor_chat()`: branches on `mode` parameter to select prompt; uses `limit=8` for `content_aware`, `limit=5` for `socratic`.

**`backend/app/main.py`** — passes `request.mode` to `tutor_service.tutor_chat()`.

### Frontend
**`knowledge-network/src/components/ai/ChatInput.tsx`**
- Added `mode: 'socratic' | 'content_aware'` and `onModeToggle: () => void` props.
- Renders a custom toggle switch (Tailwind pill): Socratic ← toggle → Content-Aware.
- Label text updates dynamically: "🧠 Socratic Mode" / "📖 Content-Aware Mode".

**`knowledge-network/src/app/ai-assistant/page.tsx`**
- Added `mode` state (`useState<'socratic' | 'content_aware'>('socratic')`).
- Passes `mode` in the chat API request body.
- Wires `onModeToggle` to flip the state.

---

## Problem 4 — Dynamic Sidebar from Firebase

### What was built
The sidebar now shows the logged-in user's own uploaded courses and topics in real time via a Firestore `onSnapshot` listener, replacing a hardcoded list.

### Backend
**`backend/app/main.py` — `/upload` (addition)**
- After `batch.commit()`, writes a `user_topics` document:
  ```python
  {userId, courseId, courseName, conceptId, title, chunkCount, createdAt}
  ```
  `conceptId` = `course_id` slug (matches chunks stored in `knowledge_chunks`).

**`backend/app/main.py` — `GET /api/user-topics`**
- Streams `user_topics` filtered by `userId == student_id`.
- Returns `[{id, courseId, courseName, conceptId, title, chunkCount}]`.

**`backend/app/main.py` — `DELETE /api/user-topics/{doc_id}`**
- Auth-checks ownership (`data.userId == student_id`).
- Cascade-deletes all matching `knowledge_chunks` where `userId == student_id && concept_id == conceptId`.
- Deletes the `user_topics` document.

### Frontend
**`knowledge-network/src/components/ai/SubjectsList.tsx`**
- Replaced hardcoded `initialSubjects` with a Firestore `onSnapshot` listener on `collection('user_topics').where('userId', '==', uid)`.
- Groups docs by `courseId` → builds `Subject[]` tree (Course → Topics).
- Loading spinner while `isLoadingSubjects`.
- Empty state: "No courses yet. Upload materials to get started."
- Each topic pill uses `note.conceptId` directly (not a re-derived slug).
- Delete button (Trash2 icon) per topic: calls `DELETE /api/user-topics/{id}`, updates sidebar immediately via the snapshot listener.
- Topic pills are draggable to the chat input; `onDragStart` serialises `{id, title, subjectName, conceptId}` as `application/json`.

---

## Problem 5 — Intervention Engine

### What was built
When a student answers incorrectly, the backend classifies the mistake type and generates targeted remediation.

### Backend
**`backend/app/services/tutor_service.py` — `run_intervention(request)`**
- Dispatches on `request.mistake_type`:
  - `"careless"` → `_careless_intervention()`: returns a fixed pattern-alert message + 3 scaffolded metacognitive questions.
  - `"conceptual"` → `_conceptual_intervention()`: walks `prerequisite_chain` to find the weakest prerequisite (mastery < 0.6), retrieves 3 context chunks about that concept, calls `gpt-5.2` to generate an opener sentence + 3 bridging guiding questions in JSON format.
- Returns `{intervention_type, message, scaffolded_questions, start_concept}`.

**`backend/app/main.py` — `POST /api/tutor/intervene`**
- Calls `tutor_service.run_intervention(request)`.

---

## Problem 6 — Session Summary

### What was built
After a practice session ends, the system generates a structured performance summary with stats and a motivational velocity note.

### Backend
**`backend/app/services/tutor_service.py` — `generate_session_summary(session)`**
- Computes: total attempts, correct count, accuracy %, concepts practiced, careless/conceptual mistake counts, session duration in minutes.
- Identifies the most-practiced correct concept ("biggest win").
- If `prior_mastery_avg` and `current_mastery_avg` are provided, generates a velocity note: "Mastery improved by Xpp (A% → B%)".
- Calls `gpt-5.2` to produce a friendly 2-sentence narrative summary.
- Returns `{total, correct, accuracy_pct, concepts_practiced, careless_count, conceptual_count, biggest_win, velocity_note, duration_minutes, summary}`.

**`backend/app/main.py` — `POST /api/tutor/session-summary`**
- Calls `tutor_service.generate_session_summary(request)`.

---

## Problem 7 — Sidebar Collapse / Layout

### What was built
The main app sidebar can be collapsed to give more space to the content area, with a persistent re-open tab.

### Frontend
**`knowledge-network/src/components/layout/MainLayout.tsx`**
- Sidebar wrapper: `overflow-hidden transition-all duration-300` with `w-64` (open) / `w-0` (collapsed).
- Persistent re-open button: fixed to `left-0 top-6`, slides in from off-screen when sidebar is open (`-translate-x-full`), slides to `translate-x-0` when collapsed — so it's never visible when the sidebar is showing but always reachable when collapsed.
- Uses `ChevronRight` icon. Rounded right edge (`rounded-r-lg`) gives a clean tab appearance.

---

## Problem 8 — Content-Aware Mode RAG Retrieval Fix

### Root causes diagnosed
1. **Broken first query path**: old code converted the user query string into a slug (e.g. `"what is the attention mechanism"` → `"what-is-the-attention-mechanism"`) and used it as a `concept_id` filter — this never matched any stored concept IDs.
2. **Stopwords inflating scores**: common words ("what", "is", "the", "how") appeared in every chunk, making unrelated chunks score 3/5.
3. **300-char text truncation**: `text[:300]` stripped valuable content from returned chunks.
4. **Top-k too low**: `limit=3` provided only ~900 chars of context to the LLM.
5. **Over-conservative prompt**: Rule 5 refused to answer if ANY context was missing, even when partial context was available.

### Fixes
**`backend/app/services/tutor_service.py`**

Added class-level `_STOPWORDS` set (50+ common English words + query-verb words like "explain", "describe").

Replaced `_token_overlap()` with `_score_chunk(query_tokens, text)`:
```python
@staticmethod
def _score_chunk(query_tokens: set, text: str) -> float:
    if not query_tokens:
        return 1.0
    text_lower = text.lower()
    hits = sum(1 for t in query_tokens if t in text_lower)
    return hits / len(query_tokens)
```

Rewrote `retrieve_context()`:
- Removed the broken slug-as-concept-id query path entirely.
- Extracts meaningful tokens: `{t for t in query.lower().split() if t not in _STOPWORDS and len(t) > 2}`.
- Two query paths:
  - If `concept_ids` given: `WHERE concept_id IN concept_ids[:10] [AND userId == uid]`.
  - Else if `user_id` given: `WHERE userId == uid`, limit 300.
  - No `user_id` → return `[]` (never scan without user isolation).
- Deduplicates by `hash(text)`.
- Returns full text (no truncation), top-N by score.

Updated `tutor_chat()`:
- `limit=8` for `content_aware`, `limit=5` for `socratic`.
- Context formatted with numbered separators: `[N] [Source: concept_id]\ntext`.

Updated `_build_content_aware_prompt()`:
- Rule 4: "If context partially covers the topic, use it as foundation and supplement with general knowledge."
- Rule 5: "Only say the topic is absent if context has NO relevance whatsoever — do not give up because context is incomplete."

---

## Problem 9 — Upload Modal on AI Assistant Sidebar

### What was built
The upload button in the SubjectsList sidebar opens a modal with the same course-selection pipeline as the `/upload` page — no separate upload system.

### Frontend
**`knowledge-network/src/components/ai/SubjectsList.tsx`**

Added `UploadResult` interface and new state: `modalCourses`, `uploadCourseId`, `newCourseName`, `pendingFiles`, `isDraggingFiles`, `uploadResults`, `fileInputRef`.

`openUploadModal()`:
- Seeds `modalCourses` from current `subjects`.
- Fetches fresh list from `GET /api/courses` and merges.

Upload form layout:
- **Existing course dropdown**: pre-populated with user's courses.
- **"Or create new" text input**: `newCourseName` — takes priority over dropdown if filled.
- **File drop zone** (drag-and-drop + click-to-browse): accepts `.pdf`, `.txt`, `.md`.
- **Pending files list** with individual remove buttons.
- **Validation**: upload button disabled unless ≥1 file AND (course selected OR new name entered).

`handleUpload()`:
- Derives `effectiveCourseId = newCourseName ? slugify(newCourseName) : uploadCourseId`.
- Posts `FormData` to `POST /upload` with `course_id`, `course_name`, all pending files.
- Shows per-file results (✓ success with chunk count, ✗ error with message).
- Calls `fetchTopics()` to refresh sidebar immediately.

---

## Problem 10 — Source Citations & Topic Pill Overflow

### 10A — Compact Collapsible Source Citations

**`knowledge-network/src/components/ai/NotesContext.tsx`** (first rewrite)
- Replaced verbose raw-text dump with compact collapsible rows.
- Each source card shows: chevron icon + file icon + slug-to-label name + relevance %.
- `slugToLabel("smu-gen-ai-topic-2")` → `"Smu Gen Ai Topic 2"`.
- Click header to expand/collapse; expanded view shows full chunk text; clicking text triggers `onNoteClick`.
- State: `expandedIds: Set<number>` keyed by array index.

### 10B — Topic Pills Horizontal Scroll

**`knowledge-network/src/components/ai/ChatInput.tsx`**
- Added `pillsRef = useRef<HTMLDivElement>(null)`.
- `handlePillsWheel`: intercepts vertical `WheelEvent` and redirects to `scrollLeft` if `|deltaY| > |deltaX|`.
- Drop zone changed from `flex flex-wrap min-h-[44px]` to `flex flex-nowrap h-[44px] overflow-x-auto`.
- Added `scrollbarWidth: 'none'` (Firefox) + `[&::-webkit-scrollbar]:hidden` (WebKit) to hide scrollbar.
- Topic pills use `flex-shrink-0 whitespace-nowrap` so they never compress.

---

## Problem 11 — Sidebar File Name Tooltips

**`knowledge-network/src/components/ai/SubjectsList.tsx`**
- Added native `title={subject.name}` on course folder buttons.
- Added native `title={note.title}` on topic file buttons.
- Course/file names use `truncate` (CSS `text-overflow: ellipsis`) so long names are visually clipped; native browser tooltip (~500 ms delay) reveals the full name on hover.
- No custom tooltip component or JS needed.

---

## Problem 12 — Smart Inline Citations Linked to Right Panel

### What was built
- AI response body contains no raw source text — only the LLM's clean answer.
- Inline clickable superscript badges (`[1]`, `[2]`) appear in the response where claims are sourced.
- Right panel sources are grouped, filtered, excerpted, and numbered to match the inline badges.
- Clicking a superscript auto-expands and scrolls to the matching source card.

### Backend
**`backend/app/services/tutor_service.py` — `tutor_chat()`**
- Assigns 1-based `index` to each chunk before formatting: `chunk["index"] = i + 1`.
- Context text sent to LLM: `[{index}] [Source: {concept_id}]\n{text}`.
- All 8 retrieved chunks (content_aware) or 5 (socratic) are returned with `index` field.

**`backend/app/services/tutor_service.py` — `_build_content_aware_prompt()`**
- New Rule 3: "Append [N] at the end of sentences that draw from source N."
- New Rule 7: "Do NOT include a 'Referenced Concepts' section — sources shown in UI."
- Updated RESPONSE FORMAT: "Write answer directly with inline [N] markers. Example: 'The model computes scaled dot-product attention [1] using Q, K, V matrices [2].'"

### Frontend — ChatWindow
**`knowledge-network/src/components/ai/ChatWindow.tsx`**
- Removed the `relatedNotes` source text dump entirely (was the "wall of raw text" bug).
- `preprocessCitations(content)`: replaces `[1]` → `%%CITE:1%%` to survive ReactMarkdown parsing without being treated as link syntax.
- `expandCitations(text, onCitationClick)`: splits on `%%CITE:N%%` and renders text fragments + `<sup>` badges (blue pill, `w-4 h-4`, click triggers `onCitationClick(N)`).
- Custom `p` and `li` markdown components call `expandCitations()` on string children; non-string children (bold, code, etc.) pass through untouched.
- New prop: `onCitationClick?: (index: number) => void`.

### Frontend — NotesContext
**`knowledge-network/src/components/ai/NotesContext.tsx`** (second rewrite)

**Grouping**: chunks with the same `concept_id` are merged into one card. Header shows all citation badges for chunks in that group.

**Filtering**: groups where `maxScore === 0` are hidden by default. A footer note shows "N sources with 0% relevance hidden".

**Limiting**: top 5 groups shown by default. "Show all N ↓" toggle reveals the rest.

**Excerpt**: each expanded chunk shows first 80 words. "Show full source" / "Show less" toggle per chunk.

**Highlighting**: new prop `highlightedSourceIndex?: number | null`. When set, the group containing that index auto-expands, smooth-scrolls into view, and the matching chunk row and citation badge get a blue tint.

**Reset**: `expandedGroupIds`, `expandedFullChunks`, `showAll` all reset when `activeNotes` changes (new response arrives).

### Frontend — page.tsx
**`knowledge-network/src/app/ai-assistant/page.tsx`**
- `ContextItem` updated to `{text, concept_id, score, index?}`.
- `Message` interface simplified — removed `relatedNotes` field.
- Added `highlightedSourceIndex: number | null` state.
- `handleSendMessage`: calls `setHighlightedSourceIndex(null)` at start of each new query.
- `ChatWindow` receives `onCitationClick={(n) => setHighlightedSourceIndex(n)}`.
- `NotesContext` receives `highlightedSourceIndex={highlightedSourceIndex}`.

---

## Primary Files Touched (Yichen)

### Backend
- `backend/app/services/tutor_service.py`
- `backend/app/main.py`
- `backend/app/models/tutor_schemas.py`

### Frontend
- `knowledge-network/src/app/ai-assistant/page.tsx`
- `knowledge-network/src/components/ai/ChatWindow.tsx`
- `knowledge-network/src/components/ai/ChatInput.tsx`
- `knowledge-network/src/components/ai/NotesContext.tsx`
- `knowledge-network/src/components/ai/SubjectsList.tsx`
- `knowledge-network/src/components/layout/MainLayout.tsx`

### Firestore Collections Used
- `knowledge_chunks` — chunk storage (Problem 1, 2)
- `users/{uid}/courses/{courseId}` — course metadata (Problem 1)
- `user_topics` — per-file sidebar entries (Problem 4, 9, 12)
