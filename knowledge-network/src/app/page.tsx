// src/app/page.tsx
'use client';

import React from 'react';
import { Card } from "@/components/ui/card";
import { Brain, Users, BookOpen, Clock } from 'lucide-react';

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Student Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Weekly Assessments</h3>
              <p className="text-2xl font-bold mt-2">4/4</p>
              <p className="text-sm text-muted-foreground">Completed this week</p>
            </div>
            <Brain className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Study Sessions</h3>
              <p className="text-2xl font-bold mt-2">12</p>
              <p className="text-sm text-muted-foreground">Scheduled this week</p>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Concepts Mastered</h3>
              <p className="text-2xl font-bold mt-2">85%</p>
              <p className="text-sm text-muted-foreground">Average confidence</p>
            </div>
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-sm text-muted-foreground">Study Time</h3>
              <p className="text-2xl font-bold mt-2">24h</p>
              <p className="text-sm text-muted-foreground">This week</p>
            </div>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h3 className="font-semibold mb-4">Upcoming Assessments</h3>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">Data Structures Quiz</h4>
                <p className="text-sm text-muted-foreground mb-2">Due in 2 days</p>
                <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90">
                  Start
                </button>
              </div>
              <div>
                <h4 className="font-medium">Physics Lab Report</h4>
                <p className="text-sm text-muted-foreground mb-2">Due in 5 days</p>
                <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90">
                  View
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h3 className="font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 mt-2" />
                <div>
                  <p className="font-medium">Completed Binary Trees Assessment</p>
                  <p className="text-sm text-muted-foreground">Score: 92%</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                <div>
                  <p className="font-medium">Joined Physics Study Group</p>
                  <p className="text-sm text-muted-foreground">4 members</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}