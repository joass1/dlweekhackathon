'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Clock, Play, Pause, RotateCcw, CheckCircle, AlertTriangle, BookOpen, Rocket } from 'lucide-react';

interface StudyConcept {
  id: string;
  title: string;
  mastery: number;
  status: 'weak' | 'learning';
  priority: 'high' | 'medium';
  decayDays: number;
  studyTip: string;
}

const prioritizedConcepts: StudyConcept[] = [
  { id: '1', title: "Momentum", mastery: 30, status: 'weak', priority: 'high', decayDays: 0, studyTip: 'Start with conservation of momentum in 1D collisions' },
  { id: '2', title: "Graph Algorithms", mastery: 20, status: 'weak', priority: 'high', decayDays: 0, studyTip: 'Begin with BFS and DFS traversals before shortest path' },
  { id: '3', title: "Newton's Third Law", mastery: 45, status: 'weak', priority: 'high', decayDays: 1, studyTip: 'Review action-reaction pairs with real-world examples' },
  { id: '4', title: "Potential Energy", mastery: 40, status: 'weak', priority: 'high', decayDays: 2, studyTip: 'Connect gravitational PE to height and elastic PE to springs' },
  { id: '5', title: "Friction", mastery: 60, status: 'learning', priority: 'medium', decayDays: 3, studyTip: 'Practice static vs kinetic friction on inclined planes' },
  { id: '6', title: "Work-Energy Theorem", mastery: 55, status: 'learning', priority: 'medium', decayDays: 4, studyTip: 'Relate net work done to change in kinetic energy' },
];

export default function StudyMissionPage() {
  const [missionActive, setMissionActive] = useState(false);
  const [studyMinutes, setStudyMinutes] = useState(25);
  const [timeRemaining, setTimeRemaining] = useState(25 * 60);
  const [currentConceptIndex, setCurrentConceptIndex] = useState(0);
  const [completedConcepts, setCompletedConcepts] = useState<Set<string>>(new Set());
  const [missionStarted, setMissionStarted] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (missionActive && timeRemaining > 0) {
      interval = setInterval(() => setTimeRemaining(t => t - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [missionActive, timeRemaining]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const markComplete = (id: string) => {
    setCompletedConcepts(prev => new Set([...prev, id]));
    if (currentConceptIndex < prioritizedConcepts.length - 1) {
      setCurrentConceptIndex(i => i + 1);
    }
  };

  const startMission = () => {
    setTimeRemaining(studyMinutes * 60);
    setMissionStarted(true);
    setMissionActive(true);
  };

  if (!missionStarted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-2">
          <Rocket className="w-6 h-6 text-emerald-600" />
          Study Mission
        </h1>
        <p className="text-gray-500 mb-8">
          Tell us how much time you have. LearnGraph AI will create an optimized study queue
          prioritized by knowledge gap severity, prerequisite depth, and decay risk.
        </p>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">How much time do you have?</h2>
          <div className="flex gap-3 mb-6">
            {[10, 15, 25, 45, 60].map(mins => (
              <button
                key={mins}
                onClick={() => setStudyMinutes(mins)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  studyMinutes === mins
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'border-gray-300 hover:border-emerald-400'
                }`}
              >
                {mins} min
              </button>
            ))}
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium mb-2">Mission Preview</h3>
            <p className="text-sm text-gray-600">
              {studyMinutes <= 15
                ? `Quick review: ${Math.min(2, prioritizedConcepts.length)} high-priority concepts`
                : studyMinutes <= 30
                ? `Focused session: ${Math.min(4, prioritizedConcepts.length)} concepts ranked by decay risk`
                : `Deep study: ${prioritizedConcepts.length} concepts from deepest prerequisite gaps up`
              }
            </p>
          </div>

          <button
            onClick={startMission}
            className="w-full py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            Start {studyMinutes}-Minute Mission
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-emerald-600" />
            Study Mission
          </h1>
          <p className="text-gray-500 text-sm">AI-prioritized concepts based on your knowledge graph</p>
        </div>

        <Card className="p-4 text-center min-w-[200px]">
          <div className="flex items-center justify-center gap-1 text-xs text-gray-500 mb-1">
            <Clock className="w-3 h-3" /> Time Remaining
          </div>
          <p className={`text-4xl font-mono font-bold mb-2 ${timeRemaining < 60 ? 'text-red-600' : ''}`}>
            {formatTime(timeRemaining)}
          </p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => setMissionActive(!missionActive)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1 text-sm">
              {missionActive ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Resume</>}
            </button>
            <button onClick={() => { setTimeRemaining(studyMinutes * 60); setMissionActive(false); }}
              className="px-3 py-2 border rounded-lg hover:bg-gray-50">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </Card>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span>{completedConcepts.size}/{prioritizedConcepts.length} concepts reviewed</span>
          <span>{Math.round((completedConcepts.size / prioritizedConcepts.length) * 100)}% complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-emerald-600 h-2 rounded-full transition-all"
            style={{ width: `${(completedConcepts.size / prioritizedConcepts.length) * 100}%` }} />
        </div>
      </div>

      {/* Concept Queue */}
      <div className="space-y-4">
        {prioritizedConcepts.map((concept, index) => (
          <Card key={concept.id}
            className={`p-4 transition-all ${
              index === currentConceptIndex && missionActive ? 'ring-2 ring-emerald-500 bg-emerald-50' :
              completedConcepts.has(concept.id) ? 'opacity-60' : ''
            }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`w-3 h-3 rounded-full ${
                    concept.status === 'weak' ? 'bg-red-500' : 'bg-yellow-500'
                  }`} />
                  <h3 className="font-semibold">{concept.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    concept.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>{concept.priority} priority</span>
                  {concept.decayDays <= 1 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Decaying
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                  <span>Mastery: {concept.mastery}%</span>
                  <span>Decay in: {concept.decayDays} days</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2 max-w-xs">
                  <div className={`h-1.5 rounded-full ${
                    concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                  }`} style={{ width: `${concept.mastery}%` }} />
                </div>
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> {concept.studyTip}
                </p>
              </div>
              <button
                onClick={() => markComplete(concept.id)}
                disabled={completedConcepts.has(concept.id)}
                className={`ml-4 px-4 py-2 rounded-lg text-sm flex-shrink-0 ${
                  completedConcepts.has(concept.id)
                    ? 'bg-green-100 text-green-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}>
                {completedConcepts.has(concept.id) ? (
                  <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Done</span>
                ) : 'Mark Reviewed'}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Session complete */}
      {completedConcepts.size === prioritizedConcepts.length && (
        <Card className="mt-6 p-6 bg-emerald-50 border-emerald-200 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-emerald-800 mb-2">Mission Complete!</h2>
          <p className="text-emerald-700 mb-4">
            You reviewed all {prioritizedConcepts.length} priority concepts. Your knowledge map has been updated.
          </p>
        </Card>
      )}
    </div>
  );
}
