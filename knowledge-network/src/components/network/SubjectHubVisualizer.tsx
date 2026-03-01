// components/SubjectHubVisualizer.tsx
'use client';

import { useState } from 'react';

interface Hub {
  id: string;
  level: number;
  members: string[];
  house: 'Gryffindor' | 'Hufflepuff' | 'Ravenclaw' | 'Slytherin';
}

interface Subject {
  id: string;
  name: string;
  code: string;
  hubs: Hub[];
}

interface NetworkUpdate {
  id: string;
  house: 'Gryffindor' | 'Hufflepuff' | 'Ravenclaw' | 'Slytherin';
  message: string;
  timestamp: Date;
}

export default function SubjectHubVisualizer() {
  // Mock user data
  const userHouse: 'Gryffindor' | 'Hufflepuff' | 'Ravenclaw' | 'Slytherin' = 'Gryffindor';

  // Mock subjects data
  const subjects: Subject[] = [
    {
      id: '1',
      name: 'Data Structures',
      code: 'CS201',
      hubs: [
        { id: '1', level: 65, members: ['Student 1', 'Student 2', 'Student 3', 'Student 4'], house: 'Gryffindor' },
        { id: '2', level: 85, members: ['Student 5', 'Student 6', 'Student 7', 'Student 8'], house: 'Hufflepuff' },
        { id: '3', level: 45, members: ['Student 9', 'Student 10', 'Student 11', 'Student 12'], house: 'Ravenclaw' },
        { id: '4', level: 75, members: ['Student 13', 'Student 14', 'Student 15', 'Student 16'], house: 'Slytherin' }
      ]
    },
    {
      id: '2',
      name: 'Physics 101',
      code: 'PHY101',
      hubs: [
        { id: '1', level: 45, members: ['Student 1', 'Student 2', 'Student 3', 'Student 4'], house: 'Gryffindor' },
        { id: '2', level: 85, members: ['Student 5', 'Student 6', 'Student 7', 'Student 8'], house: 'Hufflepuff' },
        { id: '3', level: 60, members: ['Student 9', 'Student 10', 'Student 11', 'Student 12'], house: 'Ravenclaw' },
        { id: '4', level: 80, members: ['Student 13', 'Student 14', 'Student 15', 'Student 16'], house: 'Slytherin' }
      ]
    },
    {
      id: '3',
      name: 'Biology Introduction',
      code: 'BIO101',
      hubs: [
        { id: '1', level: 65, members: ['Student 1', 'Student 2', 'Student 3', 'Student 4'], house: 'Gryffindor' },
        { id: '2', level: 85, members: ['Student 5', 'Student 6', 'Student 7', 'Student 8'], house: 'Hufflepuff' },
        { id: '3', level: 45, members: ['Student 9', 'Student 10', 'Student 11', 'Student 12'], house: 'Ravenclaw' },
        { id: '4', level: 75, members: ['Student 13', 'Student 14', 'Student 15', 'Student 16'], house: 'Slytherin' }
      ] 
    },
    {
      id: '4',
      name: 'Chemistry Basics',
      code: 'CHE101',
      hubs: [
        { id: '1', level: 65, members: ['Student 1', 'Student 2', 'Student 3', 'Student 4'], house: 'Gryffindor' },
        { id: '2', level: 85, members: ['Student 5', 'Student 6', 'Student 7', 'Student 8'], house: 'Hufflepuff' },
        { id: '3', level: 45, members: ['Student 9', 'Student 10', 'Student 11', 'Student 12'], house: 'Ravenclaw' },
        { id: '4', level: 75, members: ['Student 13', 'Student 14', 'Student 15', 'Student 16'], house: 'Slytherin' }
      ]
    }
  ];

  const [selectedSubject, setSelectedSubject] = useState<string>(subjects[0].id);

  const currentSubject = subjects.find(s => s.id === selectedSubject);

  // Mock network updates
  const networkUpdates: NetworkUpdate[] = [
    {
      id: '1',
      house: 'Slytherin',
      message: 'Professor Snape has awarded 20 points for exceptional performance in peer tutoring sessions',
      timestamp: new Date('2024-02-15T14:30:00')
    },
    {
      id: '2',
      house: 'Gryffindor',
      message: 'Professor McGonagall commends the house for their outstanding transfiguration of Data Structures concepts. 15 points awarded!',
      timestamp: new Date('2024-02-15T13:15:00')
    },
    {
      id: '3',
      house: 'Ravenclaw',
      message: 'Professor Flitwick is impressed by the innovative charm work in Physics problem-solving. 25 points to Ravenclaw!',
      timestamp: new Date('2024-02-15T11:45:00')
    },
    {
      id: '4',
      house: 'Hufflepuff',
      message: 'Professor Sprout celebrates their dedication - perfect attendance and peer support has earned them 30 points!',
      timestamp: new Date('2024-02-15T10:20:00')
    },
    {
      id: '5',
      house: 'Slytherin',
      message: 'The Potions Club study session led by prefects has earned the house 15 points for fostering inter-house collaboration',
      timestamp: new Date('2024-02-15T09:45:00')
    },
    {
      id: '6',
      house: 'Gryffindor',
      message: 'Demonstrated exceptional courage in tackling complex algorithms. Professor McGonagall awards 20 points!',
      timestamp: new Date('2024-02-15T09:15:00')
    }
  ];

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  return (
    <div className="p-6">
      {/* House Banner */}
      <div className={`mb-6 p-4 rounded-lg shadow-sm border flex items-center justify-between ${
        userHouse === 'Gryffindor' 
          ? 'bg-gradient-to-r from-red-800 to-yellow-600'
          : userHouse === 'Hufflepuff'
          ? 'bg-gradient-to-r from-yellow-600 to-black'
          : userHouse === 'Ravenclaw'
          ? 'bg-gradient-to-r from-blue-800 to-[#946B2D]'
          : 'bg-gradient-to-r from-green-800 to-silver'
      }`}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
            <span className="text-white text-xl font-bold">
              {userHouse[0]}
            </span>
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">
              {userHouse} House
            </h2>
            <p className="text-white/80 text-sm">
              "Together we rise, united we stand"
            </p>
          </div>
        </div>
        <div className="bg-white/20 px-4 py-2 rounded-lg">
          <span className="text-white font-medium">House Points: 450</span>
        </div>
      </div>

      {/* Subject Selector */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Subject
        </label>
        <select
          value={selectedSubject}
          onChange={(e) => setSelectedSubject(e.target.value)}
          className="w-full md:w-64 p-2 border rounded-lg"
        >
          {subjects.map(subject => (
            <option key={subject.id} value={subject.id}>
              {subject.name} ({subject.code})
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-6">
        {/* Main Visualization */}
        <div className="flex-1">
          {currentSubject && (
            <div className="relative h-[600px] bg-white rounded-lg shadow-sm p-6 border">
              {/* Target Balance Line */}
              <div className="absolute top-1/2 left-0 right-0 border-2 border-dashed border-gray-300">
                <span className="absolute -top-6 right-2 text-sm text-gray-600">
                  Target Balance
                </span>
              </div>

              {/* Hub Towers */}
              <div className="flex justify-around items-end h-full relative">
                {currentSubject.hubs.map((hub) => (
                  <div key={hub.id} className="relative group flex flex-col items-center">
                    {/* Tower */}
                    <div 
                      className={`w-24 rounded-t-lg transition-all duration-300 ${
                        hub.house === 'Gryffindor' 
                          ? 'bg-gradient-to-t from-red-800 to-yellow-600'
                          : hub.house === 'Hufflepuff'
                          ? 'bg-gradient-to-t from-yellow-600 to-black'
                          : hub.house === 'Ravenclaw'
                          ? 'bg-gradient-to-t from-blue-800 to-[#946B2D]'
                          : 'bg-gradient-to-b from-green-800 to-silver'
                      }`}
                      style={{ 
                        height: `${hub.level * 2}px`,
                      }}
                    >
                      {/* Hover Details */}
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full mb-2 hidden group-hover:block">
                        <div className="bg-black text-white text-sm rounded-lg px-3 py-2 whitespace-nowrap">
                          {hub.members.length} members
                        </div>
                      </div>
                    </div>
                    
                    {/* Hub Label */}
                    <div className="text-center mt-4">
                      <p className="font-medium">{hub.house}</p>
                      <p className="text-sm text-gray-600">{hub.level}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Network Feed */}
        <div className="w-80 bg-white rounded-lg shadow-sm p-4 border">
          <h3 className="font-semibold text-lg mb-4">Network Updates</h3>
          <div className="space-y-4">
            {networkUpdates.map((update) => (
              <div key={update.id} className="border-b pb-3">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${
                    update.house === 'Gryffindor' 
                      ? 'text-red-800'
                      : update.house === 'Hufflepuff'
                      ? 'text-yellow-600'
                      : update.house === 'Ravenclaw'
                      ? 'text-blue-800'
                      : 'text-green-800'
                  }`}>
                    {update.house}
                  </span>
                  <span className="text-sm text-gray-600">
                    {formatTime(update.timestamp)}
                  </span>
                </div>
                <p className="text-sm mt-1">{update.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}