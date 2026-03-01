'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Clock, Play, Pause, RotateCcw, CheckCircle, AlertTriangle, BookOpen, Rocket, Loader2 } from 'lucide-react';
import { apiFetch } from '@/services/api';
import { useStudentId } from '@/hooks/useStudentId';
import Link from 'next/link';

interface StudyPlanItem {
  concept_id: string;
  title: string;
  estimated_minutes: number;
  score: number;
  factors: {
    gap_severity: number;
    prereq_depth: number;
    decay_risk: number;
    careless_frequency: number;
  };
  mastery: number;
}

interface StudyPlanResponse {
  minutes_requested: number;
  minutes_allocated: number;
  remaining_minutes: number;
  selected_concepts: StudyPlanItem[];
  mission_briefing: string;
}

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
  category?: string;
  decayTimestamp?: string | null;
  attempts?: number;
  careless_count?: number;
}

interface KGLink {
  source: string;
  target: string;
  type: string;
}

export default function StudyMissionPage() {
  const [missionActive, setMissionActive] = useState(false);
  const [studyMinutes, setStudyMinutes] = useState(25);
  const [timeRemaining, setTimeRemaining] = useState(25 * 60);
  const [currentConceptIndex, setCurrentConceptIndex] = useState(0);
  const [completedConcepts, setCompletedConcepts] = useState<Set<string>>(new Set());
  const [missionStarted, setMissionStarted] = useState(false);
  const [studyPlan, setStudyPlan] = useState<StudyPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missionBriefing, setMissionBriefing] = useState('');

  const studentId = useStudentId();

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

  const markComplete = async (conceptId: string) => {
    setCompletedConcepts(prev => new Set([...prev, conceptId]));
    if (currentConceptIndex < (studyPlan?.selected_concepts.length ?? 0) - 1) {
      setCurrentConceptIndex(i => i + 1);
    }

    // Update mastery in knowledge graph
    try {
      await apiFetch('/api/kg/update_mastery', {
        method: 'POST',
        body: JSON.stringify({ concept_id: conceptId, is_correct: true, is_careless: false }),
      });
    } catch {
      // Non-fatal: mastery update is best-effort during study session
    }
  };

  const startMission = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch the knowledge graph to get concept states
      const graphData = await apiFetch<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph');
      const nodes = graphData.nodes ?? [];
      const links = graphData.links ?? [];

      // Filter to concepts that need work (not mastered)
      const studyCandidates = nodes.filter(
        n => n.status !== 'mastered' && n.status !== 'not_started'
      );

      if (studyCandidates.length === 0) {
        // If no concepts in progress, include all non-mastered
        studyCandidates.push(...nodes.filter(n => n.status !== 'mastered'));
      }

      if (studyCandidates.length === 0) {
        setError('No concepts found. Upload course materials first to build your knowledge graph.');
        setLoading(false);
        return;
      }

      // 2. Build prerequisite map from links
      const prerequisites: Record<string, string[]> = {};
      for (const link of links) {
        const src = typeof link.source === 'string' ? link.source : String(link.source);
        const tgt = typeof link.target === 'string' ? link.target : String(link.target);
        if (link.type === 'prerequisite') {
          if (!prerequisites[tgt]) prerequisites[tgt] = [];
          prerequisites[tgt].push(src);
        }
      }

      // 3. Call the study plan API
      const plan = await apiFetch<StudyPlanResponse>('/api/adaptive/planner/study-plan', {
        method: 'POST',
        body: JSON.stringify({
          minutes: studyMinutes,
          concepts: studyCandidates.map(n => ({
            concept_id: n.id,
            title: n.title,
            mastery: n.mastery / 100, // Backend expects 0-1 range
            decay_rate: 0.02,
            attempts: n.attempts ?? 0,
            careless_count: n.careless_count ?? 0,
            estimated_minutes: 10,
          })),
          prerequisites,
        }),
      });

      setStudyPlan(plan);
      setMissionBriefing(plan.mission_briefing);
      setTimeRemaining(studyMinutes * 60);
      setMissionStarted(true);
      setMissionActive(true);
    } catch (err) {
      console.error('Failed to generate study plan:', err);
      setError('Could not generate a study plan. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const concepts = studyPlan?.selected_concepts ?? [];

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
                ? 'Quick review: 1-2 high-priority concepts'
                : studyMinutes <= 30
                ? 'Focused session: up to 4 concepts ranked by decay risk'
                : 'Deep study: full prerequisite chain from deepest gaps up'
              }
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={startMission}
            disabled={loading}
            className="w-full py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating Study Plan...</>
            ) : (
              <><Play className="w-4 h-4" /> Start {studyMinutes}-Minute Mission</>
            )}
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

      {/* Mission Briefing */}
      {missionBriefing && (
        <Card className="p-4 mb-6 bg-emerald-50 border-emerald-200">
          <p className="text-sm text-emerald-800">{missionBriefing}</p>
        </Card>
      )}

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span>{completedConcepts.size}/{concepts.length} concepts reviewed</span>
          <span>{concepts.length > 0 ? Math.round((completedConcepts.size / concepts.length) * 100) : 0}% complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-emerald-600 h-2 rounded-full transition-all"
            style={{ width: `${concepts.length > 0 ? (completedConcepts.size / concepts.length) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Concept Queue */}
      <div className="space-y-4">
        {concepts.map((concept, index) => {
          const masteryPct = Math.round(concept.mastery * 100);
          const isWeak = masteryPct < 40;
          const isLearning = masteryPct >= 40 && masteryPct < 85;
          const decayRisk = concept.factors.decay_risk;

          return (
            <Card key={concept.concept_id}
              className={`p-4 transition-all ${
                index === currentConceptIndex && missionActive ? 'ring-2 ring-emerald-500 bg-emerald-50' :
                completedConcepts.has(concept.concept_id) ? 'opacity-60' : ''
              }`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`w-3 h-3 rounded-full ${isWeak ? 'bg-red-500' : 'bg-yellow-500'}`} />
                    <h3 className="font-semibold">{concept.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      concept.factors.gap_severity > 0.6 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {concept.factors.gap_severity > 0.6 ? 'high' : 'medium'} priority
                    </span>
                    {decayRisk > 0.5 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Decaying
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                    <span>Mastery: {masteryPct}%</span>
                    <span>~{concept.estimated_minutes} min</span>
                    <span>Score: {concept.score.toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2 max-w-xs">
                    <div className={`h-1.5 rounded-full ${
                      masteryPct >= 70 ? 'bg-green-500' : masteryPct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    }`} style={{ width: `${masteryPct}%` }} />
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>Gap: {(concept.factors.gap_severity * 100).toFixed(0)}%</span>
                    <span>Prereq depth: {concept.factors.prereq_depth}</span>
                    <span>Decay risk: {(concept.factors.decay_risk * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 ml-4">
                  <button
                    onClick={() => markComplete(concept.concept_id)}
                    disabled={completedConcepts.has(concept.concept_id)}
                    className={`px-4 py-2 rounded-lg text-sm flex-shrink-0 ${
                      completedConcepts.has(concept.concept_id)
                        ? 'bg-green-100 text-green-700'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}>
                    {completedConcepts.has(concept.concept_id) ? (
                      <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Done</span>
                    ) : 'Mark Reviewed'}
                  </button>
                  <Link
                    href={`/ai-assistant`}
                    className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                  >
                    <BookOpen className="w-3 h-3" /> Study with Tutor
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Session complete */}
      {concepts.length > 0 && completedConcepts.size === concepts.length && (
        <Card className="mt-6 p-6 bg-emerald-50 border-emerald-200 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-emerald-800 mb-2">Mission Complete!</h2>
          <p className="text-emerald-700 mb-4">
            You reviewed all {concepts.length} priority concepts. Your knowledge map has been updated.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/knowledge-map" className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              View Knowledge Map
            </Link>
            <Link href="/assessment" className="px-4 py-2 border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50 text-sm">
              Take Assessment
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
