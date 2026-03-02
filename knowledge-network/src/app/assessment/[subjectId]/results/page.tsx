'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSelfAwarenessScore } from '@/services/assessment';

interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  strengths: string[];
  availability: string[];
}

const allMockMembers: GroupMember[] = [
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
  },
  {
    id: '5',
    name: 'James Wilson',
    avatar: '/avatars/james.jpg',
    strengths: ['Visual learning expert', 'Practical applications'],
    availability: ['Mon 1-3pm', 'Wed 4-6pm']
  },
  {
    id: '6',
    name: 'Priya Patel',
    avatar: '/avatars/priya.jpg',
    strengths: ['Theoretical understanding', 'Mathematical rigor'],
    availability: ['Tue 3-5pm', 'Thu 2-4pm']
  },
  {
    id: '7',
    name: 'David Kim',
    avatar: '/avatars/david.jpg',
    strengths: ['Problem decomposition', 'Step-by-step explanation'],
    availability: ['Wed 1-3pm', 'Fri 3-5pm']
  },
  {
    id: '8',
    name: 'Sofia Martinez',
    avatar: '/avatars/sofia.jpg',
    strengths: ['Conceptual connections', 'Intuitive understanding'],
    availability: ['Mon 4-6pm', 'Thu 1-3pm']
  },
  {
    id: '9',
    name: 'Lucas Weber',
    avatar: '/avatars/lucas.jpg',
    strengths: ['Experimental approach', 'Hands-on learning'],
    availability: ['Tue 2-4pm', 'Fri 1-3pm']
  },
  {
    id: '10',
    name: 'Aisha Rahman',
    avatar: '/avatars/aisha.jpg',
    strengths: ['Abstract thinking', 'Pattern recognition'],
    availability: ['Wed 3-5pm', 'Thu 2-4pm']
  },
  {
    id: '11',
    name: 'Thomas Anderson',
    avatar: '/avatars/thomas.jpg',
    strengths: ['Systematic approach', 'Detailed analysis'],
    availability: ['Mon 2-4pm', 'Thu 3-5pm']
  },
  {
    id: '12',
    name: 'Nina Ivanova',
    avatar: '/avatars/nina.jpg',
    strengths: ['Creative problem-solving', 'Alternative perspectives'],
    availability: ['Tue 4-6pm', 'Fri 2-4pm']
  },
  {
    id: '13',
    name: 'Raj Malhotra',
    avatar: '/avatars/raj.jpg',
    strengths: ['Quantum mechanics expert', 'Advanced mathematics'],
    availability: ['Mon 3-5pm', 'Wed 2-4pm']
  },
  {
    id: '14',
    name: 'Emma Thompson',
    avatar: '/avatars/emma.jpg',
    strengths: ['Classical mechanics', 'Force analysis'],
    availability: ['Tue 2-4pm', 'Thu 1-3pm']
  },
  {
    id: '15',
    name: 'Liu Wei',
    avatar: '/avatars/liu.jpg',
    strengths: ['Thermodynamics specialist', 'Energy systems'],
    availability: ['Wed 4-6pm', 'Fri 3-5pm']
  },
  {
    id: '16',
    name: 'Zara Ahmed',
    avatar: '/avatars/zara.jpg',
    strengths: ['Fluid dynamics', 'Mathematical modeling'],
    availability: ['Mon 1-3pm', 'Thu 4-6pm']
  },
  {
    id: '17',
    name: 'Carlos Ruiz',
    avatar: '/avatars/carlos.jpg',
    strengths: ['Electromagnetic theory', 'Circuit analysis'],
    availability: ['Tue 3-5pm', 'Fri 2-4pm']
  },
  {
    id: '18',
    name: 'Yuki Tanaka',
    avatar: '/avatars/yuki.jpg',
    strengths: ['Optics specialist', 'Wave phenomena'],
    availability: ['Wed 1-3pm', 'Thu 2-4pm']
  }
];

function getRandomMembers(count: number, exclude: string = ''): GroupMember[] {
  // Filter out the current user if provided
  const availableMembers = exclude ? 
    allMockMembers.filter(m => m.id !== exclude) : 
    allMockMembers;
  
  // Shuffle array using Fisher-Yates algorithm
  const shuffled = [...availableMembers];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, count);
}

export default function AssessmentResultsPage() {
  const router = useRouter();
  const params = useParams();
  const subjectId = params.subjectId;
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  // Add a key state to force re-renders
  const [refreshKey, setRefreshKey] = useState(0);
  const [assessmentSummary, setAssessmentSummary] = useState<{
    score?: number;
    blind_spot_found_count?: number;
    blind_spot_resolved_count?: number;
    classifications?: { question_id: string; mistake_type: string; rationale: string }[];
    integration_actions?: {
      question_id: string;
      mistake_type: string;
      rpkt_probe?: { concept?: string; missing_concept?: string | null };
      intervention?: { mistake_type?: string; concept?: string; missing_concept?: string | null };
    }[];
  } | null>(null);
  const [selfAwareness, setSelfAwareness] = useState<number | null>(null);

  useEffect(() => {
    setGroupMembers(getRandomMembers(4));
  }, [refreshKey]); // Now depends on refreshKey

  useEffect(() => {
    const storageKey = `assessment_result_${subjectId as string}`;
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setAssessmentSummary({
          score: parsed?.evaluation?.score,
          blind_spot_found_count: parsed?.classification?.blind_spot_found_count,
          blind_spot_resolved_count: parsed?.classification?.blind_spot_resolved_count,
          classifications: parsed?.classification?.classifications || [],
          integration_actions: parsed?.classification?.integration_actions || [],
        });
        if (parsed?.studentId) {
          getSelfAwarenessScore(parsed.studentId)
            .then((s) => setSelfAwareness(s.score))
            .catch((err) => console.error('Failed to load self-awareness:', err));
        }
      } catch (err) {
        console.error('Failed to parse assessment summary:', err);
      }
    }
  }, [subjectId]);

  // Add a refresh button
  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1); // This will trigger a re-render with new members
  };

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">Your Peer Learning Hub is Ready!</h1>
          <p className="text-muted-foreground mb-4">
            Meet your study partners for {(subjectId as string).replace(/-/g, ' ')}. You've been matched based on complementary knowledge graph profiles.
          </p>
          {/* Add refresh button */}
          <button
            onClick={handleRefresh}
            className="text-[#03b2e6] hover:text-[#029ad0] text-sm flex items-center mx-auto"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Try Different Matches
          </button>
        </div>

        {assessmentSummary && (
          <div className="grid md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Assessment Score</p>
              <p className="text-2xl font-semibold">{assessmentSummary.score ?? 0}%</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Blind Spots Found</p>
              <p className="text-2xl font-semibold">{assessmentSummary.blind_spot_found_count ?? 0}</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Blind Spots Resolved</p>
              <p className="text-2xl font-semibold">{assessmentSummary.blind_spot_resolved_count ?? 0}</p>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Self-Awareness</p>
              <p className="text-2xl font-semibold">{selfAwareness !== null ? `${Math.round(selfAwareness * 100)}%` : '-'}</p>
            </div>
          </div>
        )}

        {!!assessmentSummary?.classifications?.length && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <h2 className="text-lg font-semibold mb-3">Mistake Classification</h2>
            <div className="space-y-3">
              {assessmentSummary.classifications.map((item) => (
                <div key={item.question_id} className="rounded border border-gray-200 p-3">
                  <p className="text-sm">
                    <span className="font-medium">{item.question_id}</span> ·{' '}
                    <span className={item.mistake_type === 'conceptual' ? 'text-amber-700' : 'text-blue-700'}>
                      {item.mistake_type}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{item.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!assessmentSummary?.integration_actions?.length && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <h2 className="text-lg font-semibold mb-3">Integration Hooks (RPKT + Intervention)</h2>
            <div className="space-y-3">
              {assessmentSummary.integration_actions.map((item) => (
                <div key={`${item.question_id}-hook`} className="rounded border border-gray-200 p-3">
                  <p className="text-sm font-medium">{item.question_id}</p>
                  <p className="text-sm text-muted-foreground">
                    RPKT target: {item.rpkt_probe?.missing_concept || item.rpkt_probe?.concept || '-'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Intervention path: {item.intervention?.mistake_type || item.mistake_type}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {groupMembers.map((member) => (
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
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Strengths</h4>
                    <div className="space-y-2">
                      {member.strengths.map((strength, index) => (
                        <div 
                          key={index}
                          className="bg-[#e0f4fb] text-[#03b2e6] px-3 py-1 rounded-full text-sm text-center"
                        >
                          {strength}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Availability</h4>
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
            onClick={() => router.push('/')}
            className="bg-[#03b2e6] text-white px-8 py-3 rounded-full hover:bg-[#029ad0]"
          >
            Go to Dashboard
          </button>
          <button 
            onClick={() => router.push('/assessment')}
            className="bg-muted text-foreground px-8 py-3 rounded-full hover:bg-accent"
          >
            Take Another Assessment
          </button>
        </div>
      </div>
    </div>
  );
}
