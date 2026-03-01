'use client';

import React, { useState, useEffect } from 'react';
import { Folder, ChevronDown, ChevronRight, FileText, Upload, GripVertical, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

interface Subject {
  id: string;
  name: string;
  notes: { id: string; title: string; conceptId: string; }[];
}

const toConceptId = (title: string) =>
  title.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

interface SubjectsListProps {
  onNoteSelect: (noteId: string) => void;
}

export function SubjectsList({ onNoteSelect }: SubjectsListProps) {
  const { user, getIdToken } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

  // Real-time listener for user's topics
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'user_topics'), where('userId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const grouped: Record<string, Subject> = {};
      snap.docs.forEach(d => {
        const row = d.data();
        const courseId: string = row.courseId || 'uncategorized';
        if (!grouped[courseId]) {
          grouped[courseId] = { id: courseId, name: row.courseName || courseId, notes: [] };
        }
        grouped[courseId].notes.push({
          id: d.id,
          title: row.title || d.id,
          conceptId: row.conceptId || toConceptId(row.title || d.id),
        });
      });
      setSubjects(Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name)));
      setIsLoadingSubjects(false);
    }, () => {
      setIsLoadingSubjects(false);
    });
    return unsub;
  }, [user?.uid]);

  const toggleSubject = (subjectId: string) => {
    const newExpanded = new Set(expandedSubjects);
    if (newExpanded.has(subjectId)) {
      newExpanded.delete(subjectId);
    } else {
      newExpanded.add(subjectId);
    }
    setExpandedSubjects(newExpanded);
  };

  const handleDeleteTopic = async (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this topic and all its chunks?')) return;
    const token = await getIdToken();
    try {
      await fetch(`${base}/api/user-topics/${docId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // onSnapshot auto-updates the list
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete topic.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    setIsUploading(true);
    const formData = new FormData();

    Array.from(files).forEach((file) => {
      formData.append('files', file);
    });

    try {
      const token = await getIdToken();
      const response = await fetch(`${base}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Upload successful:', result);
      setIsUploadModalOpen(false);
      // onSnapshot will automatically update the sidebar
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload files. Please try again.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow p-4 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">My Courses</h2>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center px-3 py-1 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600"
          >
            <Upload className="w-4 h-4 mr-1" />
            Upload
          </button>
        </div>

        {isLoadingSubjects ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : subjects.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            <p>No courses yet.</p>
            <p className="mt-1">Upload materials to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {subjects.map((subject) => (
              <div key={subject.id} className="mb-4">
                <button
                  className="flex items-center w-full p-2 bg-gray-50 hover:bg-gray-100 rounded"
                  onClick={() => toggleSubject(subject.id)}
                >
                  {expandedSubjects.has(subject.id) ? (
                    <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0" />
                  )}
                  <Folder className="w-5 h-5 mr-2 text-blue-500 flex-shrink-0" />
                  <span className="font-medium truncate">{subject.name}</span>
                </button>

                {expandedSubjects.has(subject.id) && (
                  <div className="ml-6 space-y-1 mt-1">
                    {subject.notes.map((note) => (
                      <div key={note.id} className="group flex items-center">
                        <button
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/json', JSON.stringify({
                              id: note.id,
                              title: note.title,
                              subjectName: subject.name,
                              conceptId: note.conceptId,
                            }));
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          className="flex items-center flex-1 min-w-0 p-2 hover:bg-gray-100 rounded text-sm cursor-grab"
                          onClick={() => onNoteSelect(note.id)}
                        >
                          <GripVertical className="w-3 h-3 mr-1 text-gray-400 flex-shrink-0" />
                          <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                          <span className="truncate">{note.title}</span>
                        </button>
                        <button
                          onClick={(e) => handleDeleteTopic(note.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity flex-shrink-0"
                          title="Delete topic"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Upload Files</h3>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
                disabled={isUploading}
              >
                ✕
              </button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
              <input
                type="file"
                className="hidden"
                id="file-upload"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              <label
                htmlFor="file-upload"
                className={`cursor-pointer text-sm ${
                  isUploading ? 'text-gray-400' : 'text-gray-600 hover:text-blue-500'
                }`}
              >
                {isUploading ? 'Uploading...' : 'Drop files here or click to upload'}
              </label>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                disabled={isUploading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
