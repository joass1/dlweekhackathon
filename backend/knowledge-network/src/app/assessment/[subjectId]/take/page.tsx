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
    // ... other Energy and Work questions
  ],
  // ... other subjects
};

export default function AssessmentTakePage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId as string;
  const [answers, setAnswers] = useState<{[key: number]: number}>({});
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

    setIsSubmitting(true);
    try {
      router.push(`/assessment/${subjectId}/matching`);
    } catch (error) {
      console.error('Error submitting assessment:', error);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-8">Assessment: {subjectId}</h1>
        
        <div className="space-y-8">
          {questions.map((question) => (
            <div 
              key={question.id}
              className="bg-white p-6 rounded-lg shadow-sm"
            >
              <h3 className="text-lg font-medium mb-4">
                {question.text}
                <span className="ml-2 text-sm text-gray-500">
                  ({question.type})
                </span>
              </h3>
              
              <div className="space-y-2">
                {question.options.map((option, index) => (
                  <div 
                    key={index}
                    className="flex items-center"
                  >
                    <input
                      type="radio"
                      id={`q${question.id}-${index}`}
                      name={`question-${question.id}`}
                      checked={answers[question.id] === index}
                      onChange={() => handleAnswer(question.id, index)}
                      className="mr-3"
                    />
                    <label htmlFor={`q${question.id}-${index}`}>
                      {option}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}
