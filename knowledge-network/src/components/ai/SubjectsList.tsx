'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, ChevronDown, ChevronRight, FileText,
  Upload, GripVertical, Trash2, CheckCircle, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface Subject {
  id: string;
  name: string;
  notes: { id: string; title: string; conceptId: string; }[];
}

const toConceptId = (title: string) =>
  title.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';

interface SubjectsListProps {
  onNoteSelect: (noteId: string) => void;
}

interface UploadResult {
  filename: string;
  status: 'success' | 'error';
  chunks?: number;
  error?: string;
}

export function SubjectsList({ onNoteSelect }: SubjectsListProps) {
  const { user, getIdToken } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

  // Upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [modalCourses, setModalCourses] = useState<{ id: string; name: string }[]>([]);
  const [uploadCourseId, setUploadCourseId] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

  const fetchTopics = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoadingSubjects(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${base}/api/user-topics`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const { topics } = await res.json();
      const grouped: Record<string, Subject> = {};
      topics.forEach((row: { id: string; courseId: string; courseName: string; conceptId: string; title: string }) => {
        const courseId = row.courseId || 'uncategorized';
        if (!grouped[courseId]) {
          grouped[courseId] = { id: courseId, name: row.courseName || courseId, notes: [] };
        }
        grouped[courseId].notes.push({
          id: row.id,
          title: row.title || row.id,
          conceptId: row.conceptId || toConceptId(row.title || row.id),
        });
      });
      setSubjects(Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setIsLoadingSubjects(false);
    }
  }, [user?.uid, base, getIdToken]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const toggleSubject = (subjectId: string) => {
    const next = new Set(expandedSubjects);
    if (next.has(subjectId)) next.delete(subjectId);
    else next.add(subjectId);
    setExpandedSubjects(next);
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
      await fetchTopics();
    } catch {
      alert('Failed to delete topic.');
    }
  };

  // ── Upload modal ─────────────────────────────────────────────────────────────

  const openUploadModal = async () => {
    setUploadResults([]);
    setPendingFiles([]);
    setNewCourseName('');
    setIsDraggingFiles(false);

    // Seed from already-loaded subjects while API call is in flight
    const fromSubjects = subjects.map(s => ({ id: s.id, name: s.name }));
    setModalCourses(fromSubjects);
    setUploadCourseId(fromSubjects[0]?.id ?? '');
    setIsUploadModalOpen(true);

    // Refresh from the courses API for the authoritative list
    try {
      const token = await getIdToken();
      const res = await fetch(`${base}/api/courses`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const fetched: { id: string; name: string }[] = Array.isArray(data.courses) ? data.courses : [];
        if (fetched.length > 0) {
          setModalCourses(fetched);
          setUploadCourseId(prev => (fetched.find(c => c.id === prev) ? prev : fetched[0].id));
        }
      }
    } catch {
      // subjects-derived list already set above as fallback
    }
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setIsUploadModalOpen(false);
    setPendingFiles([]);
    setUploadResults([]);
    setNewCourseName('');
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFiles(false);
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(pdf|txt|md)$/i.test(f.name));
    if (files.length) setPendingFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setPendingFiles(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const removeFile = (index: number) =>
    setPendingFiles(prev => prev.filter((_, i) => i !== index));

  const effectiveCourseId = newCourseName.trim()
    ? slugify(newCourseName.trim())
    : uploadCourseId;

  const effectiveCourseName = newCourseName.trim()
    ? newCourseName.trim()
    : (modalCourses.find(c => c.id === uploadCourseId)?.name ?? uploadCourseId);

  const canUpload = pendingFiles.length > 0 && (!!uploadCourseId || !!newCourseName.trim()) && !isUploading;

  const handleUpload = async () => {
    if (!canUpload) return;
    setIsUploading(true);
    setUploadResults([]);
    const formData = new FormData();
    pendingFiles.forEach(f => formData.append('files', f));
    formData.append('course_id', effectiveCourseId);
    formData.append('course_name', effectiveCourseName);
    try {
      const token = await getIdToken();
      const res = await fetch(`${base}/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
      const result = await res.json();
      const results: UploadResult[] = (result.files || []).map(
        (f: { filename: string; chunks: number; status?: string; error?: string }) => ({
          filename: f.filename,
          status: (f.status || 'success') as 'success' | 'error',
          chunks: f.chunks,
          error: f.error,
        })
      );
      setUploadResults(results);
      setPendingFiles([]);
      await fetchTopics();
      const ticket = typeof result?.comprehensive_quiz_ticket === 'string' ? result.comprehensive_quiz_ticket : '';
      if (ticket && typeof window !== 'undefined') {
        window.sessionStorage.setItem('comprehensive_quiz_ticket', ticket);
      }
      setIsUploadModalOpen(false);
      router.push(
        ticket
          ? `/assessment/all-concepts/take?ticket=${encodeURIComponent(ticket)}`
          : '/assessment/all-concepts/take'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadResults(pendingFiles.map(f => ({ filename: f.name, status: 'error' as const, error: message })));
    } finally {
      setIsUploading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full text-slate-100">
      <div className="flex-grow p-4 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white drop-shadow-sm">My Courses</h2>
          <button
            onClick={openUploadModal}
            className="flex items-center px-3 py-1 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600"
          >
            <Upload className="w-4 h-4 mr-1" />
            Upload
          </button>
        </div>

        {isLoadingSubjects ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#03b2e6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : subjects.length === 0 ? (
          <div className="text-center py-8 text-slate-300 text-sm">
            <p>No courses yet.</p>
            <p className="mt-1">Upload materials to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {subjects.map((subject) => (
              <div key={subject.id} className="mb-4">
                {/* Course row — title tooltip (Problem 11) */}
                <button
                  className="flex items-center w-full p-2 rounded border border-white/25 bg-slate-800/55 hover:bg-slate-700/65 transition-colors shadow-sm"
                  onClick={() => toggleSubject(subject.id)}
                  title={subject.name}
                >
                  {expandedSubjects.has(subject.id) ? (
                    <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0" />
                  )}
                  <Folder className="w-5 h-5 mr-2 text-blue-500 flex-shrink-0" />
                  <span className="font-semibold truncate text-white">{subject.name}</span>
                </button>

                {expandedSubjects.has(subject.id) && (
                  <div className="ml-6 space-y-1 mt-1">
                    {subject.notes.map((note) => (
                      <div
                        key={note.id}
                        className="group flex items-center rounded-md border border-white/20 bg-slate-900/45"
                      >
                        <button
                          draggable
                          title={note.title}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/json', JSON.stringify({
                              id: note.id,
                              title: note.title,
                              subjectName: subject.name,
                              conceptId: note.conceptId,
                            }));
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          className="flex items-center flex-1 min-w-0 p-2 hover:bg-slate-700/65 rounded-md text-sm cursor-grab text-white"
                          onClick={() => onNoteSelect(note.id)}
                        >
                          <GripVertical className="w-3 h-3 mr-1 text-slate-300 flex-shrink-0" />
                          <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-white/90" />
                          <span className="truncate font-medium">{note.title}</span>
                        </button>
                        <button
                          onClick={(e) => handleDeleteTopic(note.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-200 hover:text-red-300 transition-opacity flex-shrink-0"
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

      {/* ── Upload Modal — portalled to document.body so it sits above everything ── */}
      {isUploadModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeUploadModal(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />

          {/* Modal card — explicit white bg + black text to override any parent theme */}
          <div
            className="relative rounded-xl p-6 w-[460px] max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200"
            style={{ backgroundColor: '#ffffff', color: '#111827' }}
          >
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-gray-900">Upload Course Materials</h3>
              <button
                onClick={closeUploadModal}
                className="text-gray-400 hover:text-gray-700 text-lg leading-none"
                disabled={isUploading}
              >
                ✕
              </button>
            </div>

            {/* ── Course / project file selection ── */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-900 mb-1.5">
                Project File <span className="text-red-500">*</span>
              </label>

              {modalCourses.length > 0 && (
                <select
                  value={uploadCourseId}
                  onChange={e => { setUploadCourseId(e.target.value); setNewCourseName(''); }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm mb-2 bg-white text-gray-900"
                  disabled={isUploading || !!newCourseName.trim()}
                >
                  {modalCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}

              <div className="flex items-center gap-2">
                {modalCourses.length > 0 && (
                  <span className="text-xs text-gray-600 flex-shrink-0">or create new:</span>
                )}
                <input
                  type="text"
                  value={newCourseName}
                  onChange={e => setNewCourseName(e.target.value)}
                  placeholder={modalCourses.length === 0 ? 'Course name (required)' : 'New course name…'}
                  className="flex-1 p-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder:text-gray-400"
                  disabled={isUploading}
                />
              </div>
            </div>

            {/* ── File drop zone ── */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors mb-4 ${
                isDraggingFiles
                  ? 'border-[#03b2e6] bg-[#e0f4fb]'
                  : 'border-gray-300 hover:border-[#03b2e6]'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDraggingFiles(true); }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={handleFileDrop}
            >
              <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-600 mb-1">Drop files here or click to select</p>
              <p className="text-xs text-gray-500 mb-3">PDF, TXT, MD supported</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                id="sidebar-file-upload"
                multiple
                accept=".pdf,.txt,.md"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
              <label
                htmlFor="sidebar-file-upload"
                className="inline-block px-4 py-1.5 bg-[#03b2e6] text-white text-sm rounded-full cursor-pointer hover:bg-[#029ad0]"
              >
                Browse Files
              </label>
            </div>

            {/* ── Pending files ── */}
            {pendingFiles.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-xs text-gray-600 mb-1">Selected files:</p>
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm p-1.5 rounded bg-gray-50 text-gray-900">
                    <FileText className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                    {!isUploading && (
                      <button
                        onClick={() => removeFile(i)}
                        className="text-gray-400 hover:text-red-500 text-xs leading-none"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Upload results ── */}
            {uploadResults.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-xs text-gray-600 mb-1">Upload results:</p>
                {uploadResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm p-1.5 rounded bg-gray-50 border border-gray-200 text-gray-900">
                    {r.status === 'success' ? (
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="flex-1 truncate" title={r.filename}>{r.filename}</span>
                    <span className={`text-xs flex-shrink-0 ${r.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {r.status === 'success' ? `${r.chunks} chunks` : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Validation hint */}
            {pendingFiles.length > 0 && !uploadCourseId && !newCourseName.trim() && (
              <p className="text-xs text-amber-600 mb-3">Select or create a project file to continue.</p>
            )}

            {/* ── Actions ── */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeUploadModal}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900"
                disabled={isUploading}
              >
                {uploadResults.some(r => r.status === 'success') ? 'Close' : 'Cancel'}
              </button>
              {(uploadResults.length === 0 || pendingFiles.length > 0) && (
                <button
                  onClick={handleUpload}
                  disabled={!canUpload}
                  className="px-4 py-2 text-sm bg-[#03b2e6] text-white rounded-full hover:bg-[#029ad0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isUploading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Upload
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
