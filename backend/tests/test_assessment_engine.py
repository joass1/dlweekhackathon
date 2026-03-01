import tempfile
import unittest
from pathlib import Path

from app.models.schemas import QuizGenerateRequest, QuizSubmitRequest, StudentAnswer
from app.services.assessment_engine import AssessmentEngine


class AssessmentEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        state_path = Path(self.temp_dir.name) / "assessment_state.json"
        self.engine = AssessmentEngine(state_path)
        self.student_id = "student-test"
        self.concept = "newtons-laws"

        self.generated = self.engine.generate_quiz(
            QuizGenerateRequest(student_id=self.student_id, concept=self.concept, num_questions=3)
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_generate_quiz_returns_requested_count(self):
        self.assertEqual(len(self.generated["questions"]), 3)
        self.assertIn("generation_source", self.generated)

    def test_evaluate_and_self_awareness(self):
        questions = self.generated["questions"]
        answers = []
        for q in questions:
            answers.append(
                StudentAnswer(
                    question_id=q["question_id"],
                    selected_answer=q["options"][0],
                    confidence_1_to_5=3,
                )
            )

        evaluate = self.engine.evaluate_answer(
            QuizSubmitRequest(student_id=self.student_id, concept=self.concept, answers=answers)
        )
        self.assertGreaterEqual(evaluate.score, 0.0)

        self.engine.classify_mistake(
            QuizSubmitRequest(student_id=self.student_id, concept=self.concept, answers=answers)
        )
        sa = self.engine.get_self_awareness_score(self.student_id)
        self.assertGreaterEqual(sa.total_attempts, 1)
        self.assertGreaterEqual(sa.score, 0.0)
        self.assertLessEqual(sa.score, 1.0)

    def test_override_classification(self):
        questions = self.generated["questions"]
        first = questions[0]
        answers = [
            StudentAnswer(
                question_id=first["question_id"],
                selected_answer="__definitely_wrong__",
                confidence_1_to_5=1,
            )
        ]
        classify = self.engine.classify_mistake(
            QuizSubmitRequest(student_id=self.student_id, concept=self.concept, answers=answers)
        )
        self.assertTrue(classify.classifications)
        updated = self.engine.override_classification(self.student_id, first["question_id"])
        self.assertTrue(updated["updated"])

    def test_micro_checkpoint_flow(self):
        checkpoint = self.engine.generate_micro_checkpoint(self.student_id, self.concept, self.concept)
        self.assertTrue(checkpoint.question.question_id.startswith("checkpoint-"))
        submit = self.engine.submit_micro_checkpoint(
            self.student_id,
            checkpoint.question.question_id,
            checkpoint.question.correct_answer,
            3,
        )
        self.assertTrue(submit.is_correct)
        self.assertEqual(submit.next_action, "resolved")

    def test_persistence_roundtrip(self):
        state_path = Path(self.temp_dir.name) / "assessment_state.json"
        engine_a = AssessmentEngine(state_path)
        engine_a.generate_quiz(
            QuizGenerateRequest(student_id="persist-user", concept="momentum", num_questions=2)
        )
        engine_b = AssessmentEngine(state_path)
        out = engine_b.generate_quiz(
            QuizGenerateRequest(student_id="persist-user", concept="momentum", num_questions=2)
        )
        self.assertEqual(len(out["questions"]), 2)


if __name__ == "__main__":
    unittest.main()
