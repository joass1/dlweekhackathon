'use client';

import React, { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface Question {
  id: number;
  text: string;
  type: 'comprehension' | 'implementation' | 'integration';
  options: string[];
}

const questionsBySubject: { [key: string]: Question[] } = {
  'newtons-laws': [
    {
      id: 1,
      text: "How would you explain Newton's First Law to a peer?",
      type: 'comprehension',
      options: [
        "Objects stay still or keep moving unless a force acts on them",
        "Force equals mass times acceleration",
        "Every action has an equal and opposite reaction",
        "Objects always slow down naturally"
      ]
    },
    {
      id: 2,
      text: "When solving a problem involving forces, what's your approach?",
      type: 'implementation',
      options: [
        "Draw a free body diagram and identify all forces",
        "Immediately start plugging numbers into equations",
        "Look for similar solved examples",
        "Ask for help without trying first"
      ]
    },
    {
      id: 3,
      text: "How do you connect Newton's Laws to real-world scenarios?",
      type: 'integration',
      options: [
        "I can identify multiple examples in daily life and explain them",
        "I understand the basic concepts but struggle with applications",
        "I prefer to stick to textbook problems",
        "I find it difficult to see real-world connections"
      ]
    },
    {
      id: 4,
      text: "What happens to acceleration when force is doubled but mass stays constant?",
      type: 'comprehension',
      options: [
        "Acceleration doubles",
        "Acceleration stays the same",
        "Acceleration halves",
        "Can't determine without more information"
      ]
    },
    {
      id: 5,
      text: "How confident are you in helping others understand Newton's Laws?",
      type: 'integration',
      options: [
        "Very confident - I can explain concepts clearly",
        "Somewhat confident - I understand but might struggle explaining",
        "Not very confident - I need to strengthen my understanding",
        "Not confident - I need help understanding myself"
      ]
    }
  ],
  'energy-work': [
    {
      id: 1,
      text: "What is the relationship between work and energy?",
      type: 'comprehension',
      options: [
        "Work done equals change in energy",
        "Work and energy are unrelated",
        "Work is always greater than energy",
        "Energy cannot be changed by work"
      ]
    },
  ],
};

export default function AssessmentTakePage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId as string;
  const [answers, setAnswers] = useState<{[key: number]: number}>({});
  const [confidenceRatings, setConfidenceRatings] = useState<{[key: number]: number}>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const questions = questionsBySubject[subjectId] || [];

  const handleAnswer = (questionId: number, answerIndex: number) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answerIndex
    }));
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      alert('Please answer all questions');
      return;
    }
    if (Object.keys(confidenceRatings).length < questions.length) {
      alert('Please rate your confidence for each answer');
      return;
    }

    setIsSubmitting(true);
    try {
      router.push(`/assessment/${subjectId}/matching`);
    } catch (error) {
      console.error('Error submitting assessment:', error);
    }
    setIsSubmitting(false);
  };

  const getTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      comprehension: 'bg-blue-100 text-blue-700',
      implementation: 'bg-purple-100 text-purple-700',
      integration: 'bg-green-100 text-green-700',
    };
    return styles[type] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-2">LearnGraph Assessment: {subjectId.replace(/-/g, ' ')}</h1>
        <p className="text-sm text-gray-500 mb-8">Answer each question, then rate how confident you are in your answer.</p>

        <div className="space-y-8">
          {questions.map((question) => (
            <div
              key={question.id}
              className="bg-white p-6 rounded-lg shadow-sm"
            >
              <h3 className="text-lg font-medium mb-1">
                {question.text}
              </h3>
              <span className={`inline-block text-xs px-2 py-1 rounded-full mb-4 ${getTypeBadge(question.type)}`}>
                {question.type}
              </span>

              <div className="space-y-2">
                {question.options.map((option, index) => (
                  <div
                    key={index}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      answers[question.id] === index
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => handleAnswer(question.id, index)}
                  >
                    <input
                      type="radio"
                      id={`q${question.id}-${index}`}
                      name={`question-${question.id}`}
                      checked={answers[question.id] === index}
                      onChange={() => handleAnswer(question.id, index)}
                      className="mr-3 accent-emerald-600"
                    />
                    <label htmlFor={`q${question.id}-${index}`} className="cursor-pointer flex-1">
                      {option}
                    </label>
                  </div>
                ))}
              </div>

              {/* Confidence Rating - appears after answering */}
              {answers[question.id] !== undefined && (
                <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    How confident are you in this answer?
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-red-500 w-14">Guessing</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={confidenceRatings[question.id] || 3}
                      onChange={(e) => setConfidenceRatings(prev => ({
                        ...prev,
                        [question.id]: parseInt(e.target.value)
                      }))}
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-xs text-green-600 w-14 text-right">Certain</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1 px-14">
                    <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 italic">
                    This helps LearnGraph distinguish careless mistakes from conceptual gaps.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Analyzing...' : 'Submit Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}
