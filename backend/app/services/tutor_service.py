import json
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

try:
    from langchain.text_splitter import CharacterTextSplitter
except ImportError:
    from langchain_text_splitters import CharacterTextSplitter

from app.models.tutor_schemas import RecommendationResponse


OPENAI_TUTOR_MODEL = "gpt-5.2"


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
    def _build_unified_prompt(self, knowledge_state=None) -> str:
        prompt = (
            "You are Mentora, a warm and knowledgeable Study Companion.\n\n"
            "MISSION:\n"
            "Help the student understand concepts by giving clear, source-grounded explanations "
            "then pushing deeper with a follow-up question.\n\n"
            "RESPONSE RULES:\n"
            "1. Answer the question directly using the retrieved course context.\n"
            "2. Structure your response with bullet points for multi-part concepts.\n"
            "3. **Bold** key terms, definitions, and important buzzwords on first mention.\n"
            "4. When a claim draws from a numbered source chunk, append [N] at the end of that sentence.\n"
            "5. If the context partially covers the topic, use it as foundation and supplement "
            "with general knowledge. Only say 'not covered' if context has ZERO relevance.\n"
            "6. End with ONE Socratic follow-up question under a 'Think about this:' label.\n"
            "7. If the student is wrong, gently correct first, then guide.\n"
            "8. If the student is right, affirm briefly, add depth, then push further.\n"
            "9. Keep the explanation under 180 words. The follow-up question does not count toward this limit.\n"
            "10. Do NOT include a 'Sources' or 'Referenced Concepts' section — sources are shown separately in the UI.\n\n"
            "STYLE:\n"
            "- Concise, structured, no filler\n"
            "- Define key terms before using them\n"
            "- Use bullet points for lists or multi-component concepts\n"
            "- **Bold** important terms: model names, technique names, formulas, key definitions\n"
            "- Use analogies or examples when they clarify\n"
            "- Calm, encouraging, intellectually respectful tone\n\n"
            "FORMAT:\n"
            "[Concise explanation with **bold terms**, bullet points, and [N] citations]\n\n"
            "Think about this: [one follow-up question]\n\n"
            "--- ONE-SHOT EXAMPLE ---\n"
            "Student question: 'What is the attention mechanism in transformers?'\n\n"
            "The **attention mechanism** allows a model to weigh the relevance of every token "
            "in a sequence relative to every other token, regardless of position [1].\n\n"
            "Key components:\n"
            "- **Query (Q)**: represents the current token being compared\n"
            "- **Key (K)**: represents each preceding token to compare against\n"
            "- **Value (V)**: carries the actual information to be aggregated\n\n"
            "The attention score is computed as **scaled dot-product**: "
            "the dot product of Q and K, divided by √dk, then passed through **softmax** to get weights [2]. "
            "These weights determine how much each token contributes to the output.\n\n"
            "Unlike **RNNs** which process tokens sequentially, attention processes all tokens "
            "in parallel — making it significantly faster for long sequences [1].\n\n"
            "Think about this: If attention connects every token to every other token, "
            "why do you think the original paper proposed using *multiple* attention heads "
            "instead of just one?\n"
            "--- END EXAMPLE ---\n\n"
            "IF NO SOURCE MATERIALS ARE PROVIDED:\n"
            "- Do not give direct answers\n"
            "- Guide with questions, hints, and scaffolded prompts only\n"
            "- Use your general knowledge to craft effective guiding questions\n"
            "- Still **bold** key terms and use structured formatting\n"
        )
        if knowledge_state is not None:
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
                extra += "\nTailor your Socratic question to target these gaps where relevant."
            prompt += extra
        return prompt

    @staticmethod
    def _strip_code_fences(raw: str) -> str:
        cleaned = str(raw or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            cleaned = "\n".join(lines[1:])
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return cleaned.strip()

    def _extract_json_object(self, raw: str) -> str:
        cleaned = self._strip_code_fences(raw)
        if not cleaned:
            return ""
        if cleaned.startswith("{") and cleaned.endswith("}"):
            return cleaned
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace >= 0 and last_brace > first_brace:
            return cleaned[first_brace:last_brace + 1]
        return ""

    @staticmethod
    def _clean_text(value, fallback: str, max_len: int) -> str:
        text = " ".join(str(value or "").split()).strip()
        if not text:
            text = fallback
        return text[:max_len].strip()

    def _fallback_recommendation_reasons(self, candidate: dict) -> list:
        reasons = [
            (
                f"Your current understanding is {round(float(candidate.get('mastery', 0)))}%, "
                f"so this topic still needs attention."
            )
        ]

        unlock_count = int(candidate.get("unlock_count", 0) or 0)
        prerequisite_count = int(candidate.get("prerequisite_count", 0) or 0)
        rank_hint = int(candidate.get("rank_hint", 0) or 0)

        if unlock_count > 0:
            reasons.append(
                f"Reviewing this can unblock {unlock_count} downstream topic{'s' if unlock_count != 1 else ''}."
            )
        if candidate.get("has_decay"):
            reasons.append("It is showing review decay, so delaying it raises forgetting risk.")
        if prerequisite_count > 0:
            reasons.append(
                f"It already depends on {prerequisite_count} prerequisite"
                f"{'s' if prerequisite_count != 1 else ''}, so confusion can compound if it stays weak."
            )
        if len(reasons) < 2 and rank_hint > 0:
            reasons.append(
                f"It is already near the top of your current review queue at rank #{rank_hint}."
            )
        return reasons[:4]

    def _humanize_recommendation_reason(self, reason: str, candidate: dict) -> str:
        text = self._clean_text(reason, "", 220)
        if not text:
            return text

        mastery = round(float(candidate.get("mastery", 0) or 0))
        unlock_count = int(candidate.get("unlock_count", 0) or 0)
        prerequisite_count = int(candidate.get("prerequisite_count", 0) or 0)

        replacements = [
            (
                re.compile(r"mastery is ([\d.]+)%?,? the lowest in the candidate set, making it the most urgent gap\.?", re.I),
                f"Your current understanding is {mastery}%, which makes this the most urgent topic to revisit right now.",
            ),
            (
                re.compile(r"it has[_ ]?decay is true, indicating forgetting risk is already visible\.?", re.I),
                "This topic is due for review, so waiting longer could make it harder to remember.",
            ),
            (
                re.compile(r"unlock[_ ]?count is (\d+), so improving this can unblock at least one downstream topic\.?", re.I),
                f"Improving this now can help with {unlock_count} connected topic{'s' if unlock_count != 1 else ''} that come next.",
            ),
            (
                re.compile(r"prerequisite[_ ]?count is 0, so you can address it immediately without needing other refreshers first\.?", re.I),
                "You can work on this right away without needing to review another topic first.",
            ),
            (
                re.compile(r"prerequisite[_ ]?count is (\d+), so you can address it immediately without needing other refreshers first\.?", re.I),
                f"It builds on {prerequisite_count} earlier topic{'s' if prerequisite_count != 1 else ''}, so strengthening it now can prevent confusion from stacking up.",
            ),
            (
                re.compile(r"review decay", re.I),
                "due for review",
            ),
        ]

        for pattern, replacement in replacements:
            if pattern.search(text):
                text = pattern.sub(replacement, text)

        text = re.sub(r"\bhas_decay\b", "this topic is due for review", text, flags=re.I)
        text = re.sub(r"\bunlock_count\b", "the number of connected next topics", text, flags=re.I)
        text = re.sub(r"\bprerequisite_count\b", "the number of earlier topics it builds on", text, flags=re.I)
        text = re.sub(r"\bcandidate set\b", "current options", text, flags=re.I)
        text = re.sub(r"\bdownstream\b", "later", text, flags=re.I)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _normalize_recommendation_payload(self, raw: str, candidates: list) -> dict:
        candidate_map = {
            str(candidate.get("concept_id", "")).strip(): candidate
            for candidate in candidates
            if str(candidate.get("concept_id", "")).strip()
        }
        parsed_json = self._extract_json_object(raw)
        if not parsed_json:
            raise ValueError("Recommendation response did not contain a JSON object.")

        parsed = json.loads(parsed_json)
        concept_id = str(parsed.get("concept_id", "")).strip()
        if concept_id not in candidate_map:
            raise ValueError("Recommendation response selected a concept outside the candidate list.")

        chosen = candidate_map[concept_id]
        title = str(chosen.get("title", concept_id)).strip() or concept_id
        summary = self._clean_text(
            parsed.get("summary"),
            f"Review {title} next to strengthen the highest-value weak concept in your current queue.",
            160,
        )

        raw_reasons = parsed.get("reasons", [])
        if isinstance(raw_reasons, str):
            raw_reasons = [raw_reasons]
        reasons = []
        seen = set()
        for item in raw_reasons if isinstance(raw_reasons, list) else []:
            reason = self._humanize_recommendation_reason(str(item), chosen)
            key = reason.lower()
            if not reason or key in seen:
                continue
            seen.add(key)
            reasons.append(reason)
        if len(reasons) < 2:
            for reason in self._fallback_recommendation_reasons(chosen):
                key = reason.lower()
                if key in seen:
                    continue
                seen.add(key)
                reasons.append(reason)
                if len(reasons) >= 4:
                    break

        confidence = str(parsed.get("confidence", "medium")).strip().lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "medium"

        disclaimer = self._clean_text(
            parsed.get("disclaimer"),
            "This is guidance from your current learning signals, not an automatic grade or final judgment.",
            180,
        )

        normalized = RecommendationResponse(
            concept_id=concept_id,
            title=title,
            summary=summary,
            reasons=reasons[:4],
            confidence=confidence,
            disclaimer=disclaimer,
            provider="openai",
            model=OPENAI_TUTOR_MODEL,
        )
        return normalized.dict()

    def _build_recommendation_prompts(self, course_name: str, candidates: list, attention_summary: dict) -> tuple:
        system_prompt = (
            "You are Mentora's next-best-action recommendation engine for a learning dashboard.\n"
            "Choose exactly one concept from the provided candidate list as the single best next topic to review.\n"
            "Use only the structured candidate data. Do not invent facts, concepts, scores, dependencies, or student history.\n"
            "Primary objective: maximize immediate learning value while reducing the risk of cascading confusion.\n\n"
            "Decision policy:\n"
            "1. Prefer concepts with higher unlock_count because they unblock more downstream learning.\n"
            "2. Treat lower mastery as more urgent.\n"
            "3. If has_decay is true, increase urgency because forgetting risk is already visible.\n"
            "4. If prerequisite_count is high and mastery is weak, treat that as added risk because confusion can compound.\n"
            "5. Use rank_hint only as a final weak tie-breaker.\n"
            "6. Calibrate confidence conservatively. Use high only when one candidate clearly wins on multiple signals.\n\n"
            "Output rules:\n"
            "- Return raw JSON only. No markdown, no prose outside JSON.\n"
            "- concept_id must match a candidate exactly.\n"
            "- summary must be one short dashboard sentence.\n"
            "- reasons must contain 2 to 4 short grounded statements based on the provided fields.\n"
            "- Write for a student, not an engineer.\n"
            "- Never mention raw field names or code-style terms such as mastery, unlock_count, prerequisite_count, has_decay, rank_hint, true, or false.\n"
            "- Replace technical graph language with plain language such as connected topics, earlier topics, or due for review.\n"
            "- Do not repeat the disclaimer inside reasons.\n"
            "- disclaimer must say this is guidance, not a final judgment.\n"
        )

        user_prompt = (
            f"Course: {course_name or 'All Courses'}\n"
            f"Attention summary: {json.dumps(attention_summary or {}, ensure_ascii=False)}\n"
            f"Candidates: {json.dumps(candidates, ensure_ascii=False)}\n\n"
            "Good reason examples:\n"
            '- "Your current understanding is still low here, so this is a good place to strengthen first."\n'
            '- "Reviewing this now can make the next 3 connected topics easier."\n'
            '- "This topic is due for review, so revisiting it now lowers the risk of forgetting."\n\n'
            "Bad reason examples:\n"
            '- "This seems important."\n'
            '- "I have a feeling this is best."\n'
            '- "has_decay is true."\n'
            '- "unlock_count is 3."\n'
            '- "The student should probably read more."\n\n'
            "Return exactly this JSON schema:\n"
            '{"concept_id":"string","title":"string","summary":"string","reasons":["string"],'
            '"confidence":"high|medium|low","disclaimer":"string"}'
        )
        return system_prompt, user_prompt

    def recommend_next_action(self, course_name: str = None, candidates: list = None, attention_summary: dict = None) -> dict:
        clean_candidates = [
            {
                "concept_id": str(candidate.get("concept_id", "")).strip(),
                "title": str(candidate.get("title", "")).strip(),
                "mastery": float(candidate.get("mastery", 0) or 0),
                "status": str(candidate.get("status", "learning")).strip() or "learning",
                "unlock_count": int(candidate.get("unlock_count", 0) or 0),
                "prerequisite_count": int(candidate.get("prerequisite_count", 0) or 0),
                "has_decay": bool(candidate.get("has_decay", False)),
                "rank_hint": int(candidate.get("rank_hint", 0) or 0),
            }
            for candidate in (candidates or [])
            if str(candidate.get("concept_id", "")).strip()
        ][:8]

        if not clean_candidates:
            raise ValueError("At least one recommendation candidate is required.")
        if self.openai is None:
            raise RuntimeError("OpenAI client is not configured.")

        system_prompt, user_prompt = self._build_recommendation_prompts(
            course_name or "All Courses",
            clean_candidates,
            attention_summary or {},
        )
        response = self.openai.chat.completions.create(
            model=OPENAI_TUTOR_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=350,
            timeout=25,
        )
        raw = self._clean_text(response.choices[0].message.content, "", 4000)
        return self._normalize_recommendation_payload(raw, clean_candidates)

    def tutor_chat(self, message: str, knowledge_state=None, user_id: str = None, concept_ids: list = None) -> dict:
        context_chunks = self.retrieve_context(message, limit=8, user_id=user_id, concept_ids=concept_ids)

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

        system_prompt = self._build_unified_prompt(knowledge_state)

        response = self.openai.chat.completions.create(
            model=OPENAI_TUTOR_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Retrieved course context:\n{context_text}\n\nStudent question: {message}"},
            ],
            max_completion_tokens=600,
        )
        return {
            "answer": response.choices[0].message.content,
            "context": context_chunks,
        }

    # ── Deliverable 3b: Micro-checkpoint generation & submission ──────────────
    def generate_checkpoint(
        self,
        topic_id: str,
        session_messages: list,
        already_tested: list = None,
        user_id: str = None,
    ) -> dict:
        """Generate a multiple-choice micro-checkpoint question from conversation context."""
        context_chunks = self.retrieve_context(
            topic_id, limit=4, user_id=user_id, concept_ids=[topic_id]
        )
        context_text = "\n".join(c["text"][:300] for c in context_chunks[:3]) if context_chunks else ""

        recent_msgs = session_messages[-8:]
        conv_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in recent_msgs)
        already_str = ", ".join(already_tested) if already_tested else "none"

        prompt = (
            f"Based on this tutoring conversation about '{topic_id}', generate ONE quick "
            f"multiple-choice question to test core understanding.\n\n"
            f"Conversation:\n{conv_text}\n\n"
            f"Source material:\n{context_text}\n\n"
            f"Already tested this session: {already_str}\n\n"
            "Requirements:\n"
            "- Test conceptual understanding, not memorization\n"
            "- 4 options, formatted as 'A. ...', 'B. ...', 'C. ...', 'D. ...'\n"
            "- Concise — this is a quick check, not an exam\n"
            "- Avoid concepts already tested this session\n\n"
            'Return ONLY valid JSON (no markdown):\n'
            '{"concept_tested": "...", "question": "...", "type": "multiple_choice", '
            '"options": ["A. ...", "B. ...", "C. ...", "D. ..."], '
            '"correct_answer": "A", "explanation": "one sentence why A is correct", '
            '"difficulty": "easy"}'
        )

        response = self.openai.chat.completions.create(
            model=OPENAI_TUTOR_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=350,
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown code fences if the LLM wraps the JSON
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:])
        if raw.endswith("```"):
            raw = raw[:-3].strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {
                "concept_tested": topic_id,
                "question": f"Which best describes a core idea of '{topic_id}'?",
                "type": "multiple_choice",
                "options": ["A. Option A", "B. Option B", "C. Option C", "D. Option D"],
                "correct_answer": "A",
                "explanation": "This is based on the core concept discussed.",
                "difficulty": "medium",
            }

    def submit_checkpoint(
        self,
        session_id: str,
        topic_id: str,
        concept_tested: str,
        question: str,
        options: list,
        student_answer: str,
        correct_answer: str,
        confidence_rating: int,
        was_skipped: bool,
        user_id: str = None,
        topic_doc_id: str = None,
    ) -> dict:
        """Record checkpoint result in Firestore and return mastery delta."""
        is_correct = (student_answer == correct_answer) if not was_skipped else None

        if was_skipped:
            mastery_delta = 0.0
        elif is_correct and confidence_rating >= 4:
            mastery_delta = 0.10    # correct + high confidence
        elif is_correct:
            mastery_delta = 0.05    # correct + shaky confidence
        elif not is_correct and confidence_rating >= 4:
            mastery_delta = -0.15   # wrong + high confidence → blind spot
        else:
            mastery_delta = -0.05   # wrong + low confidence → known weakness

        if self.db and user_id:
            doc_id = str(uuid4())
            self.db.collection("user_checkpoints").document(doc_id).set({
                "userId": user_id,
                "topic_doc_id": topic_doc_id,   # user_topics Firestore doc ID (ties checkpoint to student's topic)
                "session_id": session_id,
                "topic_id": topic_id,
                "concept_tested": concept_tested,
                "question": question,
                "options": options,
                "student_answer": student_answer,
                "correct_answer": correct_answer,
                "is_correct": is_correct,
                "confidence_rating": confidence_rating,
                "was_skipped": was_skipped,
                "mastery_delta": mastery_delta,
                "timestamp": datetime.now(timezone.utc),
            })

        return {"is_correct": is_correct, "mastery_delta": mastery_delta}

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
            model=OPENAI_TUTOR_MODEL,
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
            model=OPENAI_TUTOR_MODEL,
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
