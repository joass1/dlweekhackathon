import json
import os
from datetime import datetime, timezone
from uuid import uuid4

try:
    from langchain.text_splitter import CharacterTextSplitter
except ImportError:
    from langchain_text_splitters import CharacterTextSplitter


class TutorService:
    def __init__(self, db, openai_client):
        self.db = db
        self.openai = openai_client
        self.collection = os.getenv("FIREBASE_KNOWLEDGE_CHUNKS_COLLECTION", "knowledge_chunks")

    # ── Deliverable 1 ─────────────────────────────────────────────────────────
    def embed_content(self, content: str, concept_id: str, source: str = None, user_id: str = None) -> int:
        splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        chunks = splitter.split_text(content)
        if not chunks:
            return 0

        batch = self.db.batch()
        for i, chunk in enumerate(chunks):
            doc_ref = self.db.collection(self.collection).document()
            batch.set(doc_ref, {
                "text": chunk,
                "concept_id": concept_id,
                "source": source or concept_id,
                "chunk_index": i,
                "userId": user_id,
                "created_at": datetime.now(timezone.utc),
            })
        batch.commit()
        return len(chunks)

    # ── Deliverable 2 ─────────────────────────────────────────────────────────
    _STOPWORDS = {
        "what", "is", "are", "the", "a", "an", "how", "why", "when", "where", "who",
        "does", "do", "can", "should", "would", "will", "of", "in", "on", "at", "to",
        "for", "with", "this", "that", "these", "those", "it", "its", "be", "been",
        "have", "has", "had", "i", "you", "we", "they", "my", "your", "our", "me",
        "about", "which", "and", "or", "not", "but", "if", "so", "as", "by", "from",
        "give", "tell", "explain", "describe", "define", "means", "mean",
    }

    @staticmethod
    def _score_chunk(query_tokens: set, text: str) -> float:
        """Score a chunk by how many meaningful query tokens appear in it."""
        if not query_tokens:
            return 1.0
        text_lower = text.lower()
        hits = sum(1 for t in query_tokens if t in text_lower)
        return hits / len(query_tokens)

    def _stream_and_score(self, docs, query_tokens: set) -> list:
        scored = []
        seen: set = set()
        for doc in docs:
            row = doc.to_dict()
            if not row:
                continue
            text = str(row.get("text", "")).strip()
            if not text:
                continue
            h = hash(text)
            if h in seen:
                continue
            seen.add(h)
            score = self._score_chunk(query_tokens, text)
            scored.append({
                "text": text,
                "concept_id": str(row.get("concept_id", "unknown")),
                "score": score,
                "chunk_id": str(uuid4()),
            })
        return scored

    def retrieve_context(self, query: str, limit: int = 5, user_id: str = None, concept_ids: list = None) -> list:
        if self.db is None:
            return []

        # Extract meaningful tokens (drop stopwords and very short words)
        query_tokens = {
            t for t in query.lower().split()
            if t and t not in self._STOPWORDS and len(t) > 2
        }

        # Filter out empty/falsy concept_ids
        clean_ids = [c for c in (concept_ids or []) if c]

        scored = []

        # Try concept_id-scoped retrieval first (matches per-topic concept_ids)
        if clean_ids and user_id:
            try:
                q = self.db.collection(self.collection) \
                    .where("concept_id", "in", clean_ids[:10]) \
                    .where("userId", "==", user_id)
                docs = q.limit(300).stream()
                scored = self._stream_and_score(docs, query_tokens)
            except Exception as e:
                print(f"[TutorService] concept-scoped query failed: {e}")
                scored = []

            # Fallback for legacy data: concept_ids may actually be file stems
            # (e.g. "smu_gen_ai_topic_3") while chunks use course-level
            # concept_id (e.g. "gen-ai"). Match by source filename instead.
            if not scored:
                try:
                    docs = (
                        self.db.collection(self.collection)
                        .where("userId", "==", user_id)
                        .limit(500)
                        .stream()
                    )
                    # Build set of source patterns from concept_ids for matching
                    id_patterns = set()
                    for cid in clean_ids:
                        # Normalize to lowercase, collapse separators
                        normalized = cid.lower().replace("-", "_").replace(" ", "_")
                        id_patterns.add(normalized)

                    all_chunks = []
                    for doc in docs:
                        row = doc.to_dict()
                        if not row:
                            continue
                        text = str(row.get("text", "")).strip()
                        if not text:
                            continue
                        all_chunks.append(row)

                    # Filter chunks whose source filename matches any pinned topic
                    matched = []
                    for row in all_chunks:
                        source = str(row.get("source", "")).lower().replace("-", "_").replace(" ", "_")
                        source_stem = source.rsplit(".", 1)[0] if "." in source else source
                        concept = str(row.get("concept_id", "")).lower().replace("-", "_").replace(" ", "_")
                        if any(pat in source_stem or pat in concept or source_stem in pat for pat in id_patterns):
                            matched.append(row)

                    # If source matching found results, use those; otherwise use all
                    target = matched if matched else all_chunks
                    seen: set = set()
                    for row in target:
                        text = str(row.get("text", "")).strip()
                        h = hash(text)
                        if h in seen:
                            continue
                        seen.add(h)
                        score = self._score_chunk(query_tokens, text)
                        scored.append({
                            "text": text,
                            "concept_id": str(row.get("concept_id", "unknown")),
                            "score": score,
                            "chunk_id": str(uuid4()),
                        })
                except Exception as e:
                    print(f"[TutorService] source-match fallback failed: {e}")
                    scored = []
        elif user_id:
            try:
                docs = (
                    self.db.collection(self.collection)
                    .where("userId", "==", user_id)
                    .limit(300)
                    .stream()
                )
                scored = self._stream_and_score(docs, query_tokens)
            except Exception as e:
                print(f"[TutorService] user query failed: {e}")
                scored = []

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    # ── Deliverable 3 ─────────────────────────────────────────────────────────
    def _build_content_aware_prompt(self) -> str:
        return (
            "You are Mentora, a precise and reliable Study Companion.\n\n"

            "PRIMARY OBJECTIVE:\n"
            "Provide clear, complete, and accurate answers grounded in the retrieved course context.\n\n"

            "RULES:\n"
            "1. Answer the question directly and fully.\n"
            "2. Ground your answer in the retrieved course context wherever possible.\n"
            "3. When a sentence draws from a numbered source chunk, append [N] at the end of that "
            "sentence, where N is the source number shown in the context "
            "(e.g. 'Attention uses scaled dot-product scoring [1].').\n"
            "4. If the retrieved context partially covers the topic, use it as your foundation "
            "and supplement with your general knowledge to give a complete answer.\n"
            "5. Only say the topic is absent if the retrieved context has NO relevance whatsoever "
            "to the question — do not give up just because the context is incomplete.\n"
            "6. Keep responses under 220 words.\n"
            "7. Do NOT include a 'Referenced Concepts' or 'Sources' section at the end — "
            "sources are shown separately in the UI.\n\n"

            "STYLE GUIDELINES:\n"
            "- Be structured and concise.\n"
            "- Define key terms before using them.\n"
            "- Use bullet points when listing multiple components.\n"
            "- Avoid filler language.\n\n"

            "RESPONSE FORMAT:\n"
            "Write the answer directly with inline [N] citation markers after sentences that draw "
            "from source N. Example: 'The model computes scaled dot-product attention [1] using "
            "Q, K, V matrices [2].'\n"
        )

    def _build_socratic_prompt(self, knowledge_state) -> str:
        base = (
            "You are Mentora, a warm and knowledgeable Socratic Tutor.\n\n"

            "MISSION:\n"
            "Help the student genuinely understand concepts by combining clear explanations "
            "with guided questioning. Your job is to TEACH, not just interrogate.\n\n"

            "HOW TO RESPOND:\n"
            "1. First, give a concise, clear explanation that directly addresses the student's question or statement.\n"
            "2. Use the provided course context to ground your explanation with accurate details.\n"
            "3. Then, end with ONE thoughtful follow-up question to deepen their understanding or check comprehension.\n"
            "4. If the student is clearly confused or wrong, gently correct the misconception first, then guide.\n"
            "5. If the student gives a correct answer, affirm it, add depth, and push further.\n"
            "6. Keep responses under 200 words.\n\n"

            "STYLE:\n"
            "- Be structured: explain first, then question.\n"
            "- Define key terms before using them.\n"
            "- Use analogies or examples when helpful.\n"
            "- Reference specific concepts from the course context.\n"
            "- Never respond with ONLY a question — always teach something first.\n\n"

            "TONE:\n"
            "Calm, encouraging, precise, and intellectually respectful.\n"
        )
        if knowledge_state is None:
            return base

        weak_nodes = sorted(
            [n for n in knowledge_state.nodes if n.status in ("weak", "not_started")],
            key=lambda n: n.mastery
        )[:3]
        high_gaps = [g for g in knowledge_state.gaps if g.priority == "high"][:3]

        extra = ""
        if weak_nodes:
            extra += f"\nStudent's weakest concepts: {', '.join(n.title for n in weak_nodes)}."
        if high_gaps:
            extra += f"\nIdentified gaps: {', '.join(g.concept for g in high_gaps)}."
        if extra:
            extra += "\nWeave these gaps into your explanations and follow-up questions where relevant."
        return base + extra

    def tutor_chat(self, message: str, knowledge_state=None, user_id: str = None, concept_ids: list = None, mode: str = "socratic") -> dict:
        # Content-aware mode benefits from more chunks for richer coverage
        retrieval_limit = 8 if mode == "content_aware" else 5
        context_chunks = self.retrieve_context(message, limit=retrieval_limit, user_id=user_id, concept_ids=concept_ids)

        # Assign 1-based citation indices so the LLM can reference them as [1], [2], ...
        for i, chunk in enumerate(context_chunks):
            chunk["index"] = i + 1

        # Format context with numbered labels so the LLM knows which [N] to use
        if context_chunks:
            context_text = "\n\n---\n\n".join(
                f"[{c['index']}] [Source: {c['concept_id']}]\n{c['text']}"
                for c in context_chunks
            )
        else:
            context_text = "(No course materials retrieved — answer from general knowledge.)"

        if mode == "content_aware":
            system_prompt = self._build_content_aware_prompt()
        else:
            system_prompt = self._build_socratic_prompt(knowledge_state)

        response = self.openai.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Retrieved course context:\n{context_text}\n\nStudent question: {message}"},
            ],
            max_completion_tokens=600,
        )
        return {
            "answer": response.choices[0].message.content,
            "context": context_chunks,
            "mode": mode,
        }

    # ── Deliverable 4 ─────────────────────────────────────────────────────────
    def run_intervention(self, request) -> dict:
        if request.mistake_type == "careless":
            return self._careless_intervention(request)
        elif request.mistake_type == "conceptual":
            return self._conceptual_intervention(request)
        raise ValueError(f"Unknown mistake_type: {request.mistake_type}")

    def _careless_intervention(self, request) -> dict:
        return {
            "intervention_type": "careless",
            "message": (
                f"Pattern alert: This type of mistake on '{request.failed_concept}' "
                "often comes from rushing. Take a breath and re-read the question carefully."
            ),
            "scaffolded_questions": [
                "What exactly does the question ask you to find?",
                "What information is given, and what are the units?",
                "Can you re-work just the first step of your solution?",
            ],
            "start_concept": request.failed_concept,
        }

    def _conceptual_intervention(self, request) -> dict:
        start_concept = request.failed_concept

        if request.prerequisite_chain and request.knowledge_state:
            node_mastery = {n.id: n.mastery for n in request.knowledge_state.nodes}
            for concept in request.prerequisite_chain.ordered_concepts:
                if node_mastery.get(concept, 1.0) < 0.6:
                    start_concept = concept
                    break
        elif request.prerequisite_chain:
            start_concept = request.prerequisite_chain.ordered_concepts[0]

        prereq_context = self.retrieve_context(start_concept, limit=3)
        context_text = " ".join(c["text"] for c in prereq_context)
        chain_str = " → ".join(
            request.prerequisite_chain.ordered_concepts
            if request.prerequisite_chain
            else [start_concept, request.failed_concept]
        )

        llm_prompt = (
            f'A student failed a question on "{request.failed_concept}". '
            f'They need to rebuild from "{start_concept}".\n'
            f"Concept chain: {chain_str}\n"
            f"Course context about {start_concept}: {context_text}\n\n"
            f"Write ONE opening sentence (max 30 words) acknowledging the gap without judgment.\n"
            f"Then write EXACTLY 3 guiding questions bridging from \"{start_concept}\" to \"{request.failed_concept}\".\n"
            f'Return ONLY valid JSON: {{"opener": "...", "questions": ["q1", "q2", "q3"]}}'
        )

        response = self.openai.chat.completions.create(
            model="gpt-5.2",
            messages=[{"role": "user", "content": llm_prompt}],
            max_completion_tokens=300,
        )

        raw = response.choices[0].message.content.strip()
        try:
            parsed = json.loads(raw)
            opener = parsed.get("opener", f"Let's revisit {start_concept} together.")
            questions = parsed.get("questions", [])[:3]
        except json.JSONDecodeError:
            opener = f"Let's strengthen your understanding of {start_concept} first."
            questions = [
                f"What do you recall about {start_concept}?",
                f"How does {start_concept} connect to the next step?",
                f"Now apply that — what does it mean for {request.failed_concept}?",
            ]

        return {
            "intervention_type": "conceptual",
            "message": opener,
            "scaffolded_questions": questions,
            "start_concept": start_concept,
        }

    # ── Deliverable 5 ─────────────────────────────────────────────────────────
    def generate_session_summary(self, session) -> dict:
        total = len(session.attempts)
        correct = sum(1 for a in session.attempts if a.is_correct)
        accuracy = (correct / total * 100) if total > 0 else 0.0
        concepts_practiced = list({a.concept for a in session.attempts})
        careless_count = sum(
            1 for a in session.attempts if not a.is_correct and a.mistake_type == "careless"
        )
        conceptual_count = sum(
            1 for a in session.attempts if not a.is_correct and a.mistake_type == "conceptual"
        )

        start_dt = datetime.fromisoformat(session.session_start_iso)
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        duration_minutes = (datetime.now(timezone.utc) - start_dt).total_seconds() / 60.0

        correct_concepts = [a.concept for a in session.attempts if a.is_correct]
        best_concept = (
            max(set(correct_concepts), key=correct_concepts.count)
            if correct_concepts else "the session"
        )

        velocity_hint = ""
        if session.prior_mastery_avg is not None and session.current_mastery_avg is not None:
            delta = session.current_mastery_avg - session.prior_mastery_avg
            velocity_hint = (
                f"Mastery improved by {delta * 100:.1f}pp "
                f"({session.prior_mastery_avg * 100:.0f}% → {session.current_mastery_avg * 100:.0f}%)."
            )

        llm_prompt = (
            "A student completed a study session. Summarize warmly and concisely.\n\n"
            f"Questions: {total}, Correct: {correct} ({accuracy:.0f}%), "
            f"Concepts: {', '.join(concepts_practiced)}, "
            f"Careless: {careless_count}, Conceptual gaps: {conceptual_count}, "
            f"Best concept: {best_concept}, Duration: {duration_minutes:.0f} min. {velocity_hint}\n\n"
            "Write EXACTLY two sentences:\n"
            "1. Biggest Win: celebrate one specific achievement.\n"
            "2. Learning Velocity: compare progress to typical pace.\n"
            'Return ONLY valid JSON: {"biggest_win": "...", "velocity_note": "..."}'
        )

        response = self.openai.chat.completions.create(
            model="gpt-5.2",
            messages=[{"role": "user", "content": llm_prompt}],
            max_completion_tokens=150,
        )

        raw = response.choices[0].message.content.strip()
        try:
            parsed = json.loads(raw)
            biggest_win = parsed.get("biggest_win", "Great work completing this session!")
            velocity_note = parsed.get("velocity_note", "Keep up the momentum.")
        except json.JSONDecodeError:
            biggest_win = "Great work completing this session!"
            velocity_note = "Keep up the momentum."

        return {
            "total_questions": total,
            "correct": correct,
            "accuracy_pct": round(accuracy, 1),
            "concepts_practiced": concepts_practiced,
            "careless_count": careless_count,
            "conceptual_count": conceptual_count,
            "biggest_win": biggest_win,
            "velocity_note": velocity_note,
            "duration_minutes": round(duration_minutes, 1),
        }
