import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Subject configurations
const SUBJECTS = {
  'dsa': {
    title: 'Data Structures & Algorithms',
    description: 'Upload and manage your DSA study materials, code samples, and notes.',
  },
  'fluid-mechanics': {
    title: 'Fluid Mechanics',
    description: 'Store your fluid mechanics calculations, diagrams, and research papers.',
  },
  'differential-equations': {
    title: 'Differential Equations',
    description: 'Organize your differential equations homework, solutions, and study guides.',
  }
};

const SubjectPage = () => {
  const { subject } = useParams();
  const navigate = useNavigate();
  
  if (!subject || !SUBJECTS[subject]) {
    navigate('/dashboard');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <button 
          onClick={() => navigate('/dashboard')}
          className="mb-8 text-violet-500 hover:text-violet-400 flex items-center gap-2"
        >
          ← Back to Dashboard
        </button>
        <h1 className="text-3xl font-bold text-white mb-2">
          {SUBJECTS[subject].title}
        </h1>
        <p className="text-gray-400 mb-8">
          {SUBJECTS[subject].description}
        </p>
        {/* Add your file management UI here */}
      </div>
    </div>
  );
};

export default SubjectPage;