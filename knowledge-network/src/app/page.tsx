'use client';

import React from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Flame, Rocket, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';

export default function Page() {
  const priorityConcepts = [
    { name: 'Momentum', mastery: 30, status: 'weak' as const, decayDays: 0 },
    { name: "Newton's Third Law", mastery: 45, status: 'weak' as const, decayDays: 1 },
    { name: 'Potential Energy', mastery: 40, status: 'weak' as const, decayDays: 2 },
    { name: 'Graph Algorithms', mastery: 20, status: 'weak' as const, decayDays: 0 },
    { name: 'Friction', mastery: 60, status: 'learning' as const, decayDays: 3 },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">LearnGraph AI Dashboard</h1>
        <p className="text-sm text-gray-500">Your adaptive learning companion</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Concepts Mastered</h3>
              <p className="text-2xl font-bold mt-1">24<span className="text-base font-normal text-gray-400">/37</span></p>
              <p className="text-sm text-green-600">65% mastery rate</p>
            </div>
            <BookOpen className="h-5 w-5 text-green-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Concepts Decaying</h3>
              <p className="text-2xl font-bold mt-1 text-yellow-600">5</p>
              <p className="text-sm text-yellow-600">Need review soon</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Study Streak</h3>
              <p className="text-2xl font-bold mt-1">7 days</p>
              <p className="text-sm text-orange-600">Keep it going!</p>
            </div>
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Next Mission</h3>
              <p className="text-2xl font-bold mt-1">25 min</p>
              <p className="text-sm text-emerald-600">6 concepts queued</p>
            </div>
            <Rocket className="h-5 w-5 text-emerald-500" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold">Knowledge Map Preview</h3>
            <Link href="/knowledge-map" className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
              Full Map <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-[380px]">
            <KnowledgeGraph />
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Priority Concepts</h3>
              <p className="text-xs text-gray-500">Ranked by gap severity + decay risk</p>
            </div>
            <div className="p-4 space-y-3">
              {priorityConcepts.map((concept, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    concept.status === 'weak' ? 'bg-red-500' : 'bg-yellow-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{concept.name}</p>
                    <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                      <div className={`h-1 rounded-full ${
                        concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`} style={{ width: `${concept.mastery}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">{concept.mastery}%</span>
                  {concept.decayDays <= 1 && (
                    <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Quick Actions</h3>
            </div>
            <div className="p-4 space-y-2">
              <Link href="/study-mission" className="block w-full p-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-center text-sm font-medium">
                Start 25-Minute Study Mission
              </Link>
              <Link href="/upload" className="block w-full p-3 border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50 text-center text-sm font-medium">
                Upload Course Materials
              </Link>
              <Link href="/assessment" className="block w-full p-3 border rounded-lg hover:bg-gray-50 text-center text-sm font-medium">
                Take an Assessment
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
