'use client';

import React from 'react';
import { useRouter, useParams } from 'next/navigation';

interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  strengths: string[];
  availability: string[];
}

const mockGroupMembers: GroupMember[] = [
  {
    id: '1',
    name: 'Alex Chen',
    avatar: '/avatars/alex.jpg',
    strengths: ['Strong in comprehension', 'Good at explaining concepts'],
    availability: ['Mon 2-4pm', 'Wed 3-5pm']
  },
  {
    id: '2',
    name: 'Sarah Johnson',
    avatar: '/avatars/sarah.jpg',
    strengths: ['Excellent problem-solving', 'Implementation focused'],
    availability: ['Tue 1-3pm', 'Thu 4-6pm']
  },
  {
    id: '3',
    name: 'Miguel Rodriguez',
    avatar: '/avatars/miguel.jpg',
    strengths: ['Great at integration', 'Real-world applications'],
    availability: ['Mon 3-5pm', 'Fri 2-4pm']
  },
  {
    id: '4',
    name: 'Emily Zhang',
    avatar: '/avatars/emily.jpg',
    strengths: ['Analytical thinking', 'Mathematical modeling'],
    availability: ['Wed 2-4pm', 'Thu 3-5pm']
  }
];

export default function AssessmentResultsPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">🎉 Your Study Group is Ready!</h1>
          <p className="text-gray-600">
            Meet your study partners for {subjectId}. You've been matched based on complementary strengths.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {mockGroupMembers.map((member) => (
            <div 
              key={member.id}
              className="bg-white rounded-xl shadow-sm overflow-hidden transform hover:scale-105 transition-all"
            >
              <div className="p-6">
                <div className="w-24 h-24 mx-auto mb-4">
                  <img
                    src={member.avatar}
                    alt={member.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-semibold text-center mb-4">
                  {member.name}
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Strengths</h4>
                    <div className="space-y-2">
                      {member.strengths.map((strength, index) => (
                        <div 
                          key={index}
                          className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm text-center"
                        >
                          {strength}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Availability</h4>
                    <div className="space-y-2">
                      {member.availability.map((time, index) => (
                        <div 
                          key={index}
                          className="bg-green-50 text-green-700 px-3 py-1 rounded-full text-sm text-center"
                        >
                          {time}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center space-x-4">
          <button 
            onClick={() => router.push('/dashboard')}
            className="bg-blue-500 text-white px-8 py-3 rounded-lg hover:bg-blue-600"
          >
            Go to Dashboard
          </button>
          <button 
            onClick={() => router.push('/assessment')}
            className="bg-gray-100 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-200"
          >
            Take Another Assessment
          </button>
        </div>
      </div>
    </div>
  );
}
