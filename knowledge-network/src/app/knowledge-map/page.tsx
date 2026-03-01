'use client';

import React, { useState } from 'react';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { Card } from '@/components/ui/card';

export default function KnowledgeMapPage() {
  const [selectedCourse, setSelectedCourse] = useState('all');

  const courses = [
    { id: 'all', name: 'All Courses' },
    { id: 'physics', name: 'Physics 101' },
    { id: 'data-structures', name: 'Data Structures' },
  ];

  const stats = {
    total: 14,
    mastered: 4,
    learning: 5,
    weak: 4,
    notStarted: 1,
  };

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Map</h1>
          <p className="text-sm text-gray-500">Visualize your mastery across all concepts. Drag nodes to rearrange.</p>
        </div>
        <select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="p-2 border rounded-lg"
        >
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card className="p-3 border-l-4 border-l-green-500">
          <p className="text-sm text-gray-500">Mastered</p>
          <p className="text-xl font-bold text-green-600">{stats.mastered}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-yellow-500">
          <p className="text-sm text-gray-500">Learning</p>
          <p className="text-xl font-bold text-yellow-600">{stats.learning}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-red-500">
          <p className="text-sm text-gray-500">Weak</p>
          <p className="text-xl font-bold text-red-600">{stats.weak}</p>
        </Card>
        <Card className="p-3 border-l-4 border-l-gray-300">
          <p className="text-sm text-gray-500">Not Started</p>
          <p className="text-xl font-bold text-gray-400">{stats.notStarted}</p>
        </Card>
      </div>

      <Card className="flex-1 min-h-0">
        <KnowledgeGraph />
      </Card>
    </div>
  );
}
