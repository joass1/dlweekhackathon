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
    def embed_content(self, content: str, concept_id: str, source: str = None) -> int:
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
                "created_at": datetime.now(timezone.utc),
            })
        batch.commit()
        return len(chunks)

    # ── Deliverable 2 ─────────────────────────────────────────────────────────
    @staticmethod
    def _token_overlap(query: str, text: str) -> float:
        tokens = {t for t in query.lower().split() if t}
        if not tokens:
            return 0.0
        text_lower = text.lower()
        return sum(1 for t in tokens if t in text_lower) / len(tokens)

    def retrieve_context(self, concept: str, limit: int = 4) -> list:
        concept_id_slug = concept.lower().replace(" ", "-").replace("'", "")

        # Try concept_id filtered fetch first
        docs = (
            self.db.collection(self.collection)
            .where("concept_id", "==", concept_id_slug)
            .limit(50)
            .stream()
        )

        rows = [doc.to_dict() for doc in docs if doc.to_dict()]
        if not rows:
            # Fallback: scan recent chunks and score by token overlap
            docs = self.db.collection(self.collection).limit(200).stream()
            rows = [doc.to_dict() for doc in docs if doc.to_dict()]

        scored = []
        seen = set()
        for row in rows:
            text = str(row.get("text", ""))
            if not text:
                continue
            h = hash(text)
            if h in seen:
                continue
            seen.add(h)
            score = self._token_overlap(concept, text)
            scored.append({
                "text": text[:300],
                "concept_id": str(row.get("concept_id", "unknown")),
                "score": score,
                "chunk_id": str(uuid4()),
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    # ── Deliverable 3 ─────────────────────────────────────────────────────────
    def _build_socratic_prompt(self, knowledge_state) -> str:
        base = (
            "You are the LearnGraph AI Socratic Tutor.\n"
            "CRITICAL RULES:\n"
            "1. NEVER give a direct answer or solution.\n"
            "2. ONLY respond with guiding questions that help the student discover the answer.\n"
            "3. Ask ONE clear question at a time.\n"
            "4. Reference specific concepts from the provided course context.\n"
            "5. Keep your response under 120 words.\n"
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
            extra += "\nTailor your guiding questions toward these gaps where relevant."
        return base + extra

    def tutor_chat(self, message: str, knowledge_state=None) -> dict:
        context_chunks = self.retrieve_context(message, limit=3)
        context_text = " ".join(c["text"] for c in context_chunks)
        system_prompt = self._build_socratic_prompt(knowledge_state)

        response = self.openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Course context:\n{context_text}\n\nStudent question: {message}"},
            ],
            max_tokens=200,
            temperature=0.7,
        )
        return {
            "answer": response.choices[0].message.content,
            "context": context_chunks,
            "mode": "socratic_aware" if knowledge_state else "socratic_basic",
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
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": llm_prompt}],
            max_tokens=300,
            temperature=0.6,
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
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": llm_prompt}],
            max_tokens=150,
            temperature=0.8,
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
