'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, ChevronDown, ChevronRight, FileText,
  Upload, GripVertical, Trash2, CheckCircle, AlertCircle, MoreHorizontal, Pencil,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/services/api';
import { normalizeTopicRow, TopicOption, UserTopicApiRow } from '@/types/topics';

interface Subject {
  id: string;
  name: string;
  notes: { id: string; title: string; conceptId: string }[];
}

interface SubjectsListProps {
  onNoteSelect: (noteId: string) => void;
}

interface UploadResult {
  filename: string;
  status: 'success' | 'error';
  chunks?: number;
  error?: string;
}

interface SubjectNote {
  id: string;
  title: string;
  conceptId: string;
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

export function SubjectsList({ onNoteSelect }: SubjectsListProps) {
  const { user, getIdToken } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [allTopics, setAllTopics] = useState<TopicOption[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [modalCourses, setModalCourses] = useState<{ id: string; name: string }[]>([]);
  const [uploadCourseId, setUploadCourseId] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [uploadTopicId, setUploadTopicId] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [modalError, setModalError] = useState<string | null>(null);
  const [activeCourseMenuId, setActiveCourseMenuId] = useState<string | null>(null);
  const [renameCourseId, setRenameCourseId] = useState<string | null>(null);
  const [renameCourseValue, setRenameCourseValue] = useState('');
  const [isSavingCourseRename, setIsSavingCourseRename] = useState(false);
  const [activeTopicMenuId, setActiveTopicMenuId] = useState<string | null>(null);
  const [renameTopicId, setRenameTopicId] = useState<string | null>(null);
  const [renameTopicValue, setRenameTopicValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTopics = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoadingSubjects(true);
    try {
      const token = await getIdToken();
      const response = await apiFetch<{ topics?: UserTopicApiRow[] }>('/api/user-topics', undefined, token);
      const rows = Array.isArray(response.topics) ? response.topics : [];
      const normalized = rows.map(normalizeTopicRow).filter((topic) => topic.id);
      const deduped = Object.values(
        normalized.reduce<Record<string, TopicOption>>((acc, topic) => {
          acc[`${topic.courseId}::${topic.id}`] = topic;
          return acc;
        }, {})
      );
      setAllTopics(deduped);

      const grouped: Record<string, Subject> = {};
      for (const topic of deduped) {
        if (!grouped[topic.courseId]) {
          grouped[topic.courseId] = {
            id: topic.courseId,
            name: topic.courseName || topic.courseId,
            notes: [],
          };
        }
        grouped[topic.courseId].notes.push({
          id: topic.docId || `${topic.courseId}-${topic.id}`,
          title: topic.name,
          conceptId: topic.id,
        });
      }
      const nextSubjects = Object.values(grouped)
        .map((subject) => ({
          ...subject,
          notes: [...subject.notes].sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setSubjects(nextSubjects);
    } finally {
      setIsLoadingSubjects(false);
    }
  }, [getIdToken, user?.uid]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  useEffect(() => {
    if (!activeTopicMenuId && !activeCourseMenuId) return;
    const handleOutsideClick = () => {
      setActiveTopicMenuId(null);
      setActiveCourseMenuId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [activeCourseMenuId, activeTopicMenuId]);

  const courseTopics = useMemo(
    () => allTopics.filter((topic) => topic.courseId === uploadCourseId),
    [allTopics, uploadCourseId]
  );

  useEffect(() => {
    setUploadTopicId((prev) => {
      if (prev && courseTopics.some((topic) => topic.id === prev)) return prev;
      return courseTopics[0]?.id ?? '';
    });
  }, [courseTopics]);

  const toggleSubject = (subjectId: string) => {
    const next = new Set(expandedSubjects);
    if (next.has(subjectId)) next.delete(subjectId);
    else next.add(subjectId);
    setExpandedSubjects(next);
  };

  const handleDeleteTopic = async (docId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm('Delete this topic and all its chunks?')) return;
    const token = await getIdToken();
    try {
      await apiFetch(`/api/user-topics/${docId}`, { method: 'DELETE' }, token);
      await fetchTopics();
    } catch {
      alert('Failed to delete topic.');
    }
  };

  const startCourseRename = (courseId: string, currentName: string) => {
    setRenameCourseId(courseId);
    setRenameCourseValue(currentName);
    setActiveCourseMenuId(null);
  };

  const cancelCourseRename = () => {
    setRenameCourseId(null);
    setRenameCourseValue('');
  };

  const saveCourseRename = async (courseId: string) => {
    const nextName = renameCourseValue.trim();
    if (!nextName) {
      alert('Course name cannot be empty.');
      return;
    }
    setIsSavingCourseRename(true);
    try {
      const token = await getIdToken();
      await apiFetch(
        `/api/courses/${encodeURIComponent(courseId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: nextName }),
        },
        token
      );
      await fetchTopics();
      cancelCourseRename();
    } catch {
      alert('Failed to rename course.');
    } finally {
      setIsSavingCourseRename(false);
    }
  };

  const startTopicRename = (note: SubjectNote) => {
    setRenameTopicId(note.id);
    setRenameTopicValue(note.title);
    setActiveTopicMenuId(null);
  };

  const cancelTopicRename = () => {
    setRenameTopicId(null);
    setRenameTopicValue('');
  };

  const saveTopicRename = async (docId: string) => {
    const nextName = renameTopicValue.trim();
    if (!nextName) {
      alert('Topic name cannot be empty.');
      return;
    }
    setIsSavingRename(true);
    try {
      const token = await getIdToken();
      await apiFetch(
        `/api/user-topics/${docId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ topic_name: nextName }),
        },
        token
      );
      await fetchTopics();
      cancelTopicRename();
    } catch {
      alert('Failed to rename topic.');
    } finally {
      setIsSavingRename(false);
    }
  };

  const openUploadModal = async () => {
    setUploadResults([]);
    setPendingFiles([]);
    setNewCourseName('');
    setNewTopicName('');
    setModalError(null);
    setIsDraggingFiles(false);

    const fromSubjects = subjects.map((subject) => ({ id: subject.id, name: subject.name }));
    setModalCourses(fromSubjects);
    setUploadCourseId(fromSubjects[0]?.id ?? '');
    setIsUploadModalOpen(true);

    try {
      const token = await getIdToken();
      const [courseData, topicData] = await Promise.all([
        apiFetch<{ courses?: { id: string; name: string }[] }>('/api/courses', undefined, token),
        apiFetch<{ topics?: UserTopicApiRow[] }>('/api/user-topics', undefined, token),
      ]);
      const fetchedCourses = Array.isArray(courseData.courses) ? courseData.courses : [];
      const fetchedTopics = Array.isArray(topicData.topics)
        ? topicData.topics.map(normalizeTopicRow).filter((topic) => topic.id)
        : [];
      if (fetchedCourses.length > 0) {
        setModalCourses(fetchedCourses);
        setUploadCourseId((prev) => (fetchedCourses.some((course) => course.id === prev) ? prev : fetchedCourses[0].id));
      }
      setAllTopics(
        Object.values(
          fetchedTopics.reduce<Record<string, TopicOption>>((acc, topic) => {
            acc[`${topic.courseId}::${topic.id}`] = topic;
            return acc;
          }, {})
        )
      );
    } catch {
      // Keep fallback data already loaded from sidebar state.
    }
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setIsUploadModalOpen(false);
    setPendingFiles([]);
    setUploadResults([]);
    setNewCourseName('');
    setNewTopicName('');
    setModalError(null);
  };

  const handleFileDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => /\.(pdf|txt|md)$/i.test(file.name));
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    event.target.value = '';
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const effectiveCourseName = newCourseName.trim()
    ? newCourseName.trim()
    : (modalCourses.find((course) => course.id === uploadCourseId)?.name ?? uploadCourseId);
  const effectiveCourseId = newCourseName.trim()
    ? slugify(newCourseName.trim())
    : uploadCourseId;

  const canUpload =
    pendingFiles.length > 0 &&
    (!!effectiveCourseId || !!newCourseName.trim()) &&
    (newCourseName.trim() ? !!newTopicName.trim() : (!!uploadTopicId || !!newTopicName.trim())) &&
    !isUploading;

  const handleUpload = async () => {
    if (!canUpload) return;
    setIsUploading(true);
    setUploadResults([]);
    setModalError(null);

    const topicDraft = newTopicName.trim();
    let effectiveTopicId = newCourseName.trim() ? '' : uploadTopicId;
    let effectiveTopicName = newCourseName.trim()
      ? ''
      : (courseTopics.find((topic) => topic.id === uploadTopicId)?.name ?? '');
    if (topicDraft) {
      const reused = courseTopics.find(
        (topic) => topic.name.toLowerCase() === topicDraft.toLowerCase() || topic.id === slugify(topicDraft)
      );
      if (reused) {
        effectiveTopicId = reused.id;
        effectiveTopicName = reused.name;
      } else {
        effectiveTopicId = slugify(topicDraft);
        effectiveTopicName = topicDraft;
        setAllTopics((prev) => {
          const exists = prev.some((topic) => topic.courseId === effectiveCourseId && topic.id === effectiveTopicId);
          if (exists) return prev;
          return [
            ...prev,
            {
              id: effectiveTopicId,
              name: effectiveTopicName,
              courseId: effectiveCourseId,
              courseName: effectiveCourseName,
            },
          ];
        });
      }
    }

    if (!effectiveTopicId || !effectiveTopicName) {
      setModalError('Select or create a topic before uploading.');
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    pendingFiles.forEach((file) => formData.append('files', file));
    formData.append('course_id', effectiveCourseId);
    formData.append('course_name', effectiveCourseName);
    formData.append('topic_id', effectiveTopicId);
    formData.append('topic_name', effectiveTopicName);

    try {
      const token = await getIdToken();
      const result = await apiFetch<{
        files?: { filename: string; chunks: number; status?: string; error?: string }[];
        comprehensive_quiz_ticket?: string;
        quiz_ready?: boolean;
        quiz_error?: string | null;
      }>(
        '/upload',
        {
          method: 'POST',
          body: formData,
        },
        token
      );

      const results: UploadResult[] = (result.files || []).map((file) => ({
        filename: file.filename,
        status: (file.status || 'success') as 'success' | 'error',
        chunks: file.chunks,
        error: file.error,
      }));
      setUploadResults(results);
      setPendingFiles([]);
      await fetchTopics();

      const ticket = typeof result?.comprehensive_quiz_ticket === 'string' ? result.comprehensive_quiz_ticket : '';
      const hasSuccess = results.some((file) => file.status === 'success');
      if (ticket && typeof window !== 'undefined') {
        window.sessionStorage.setItem('comprehensive_quiz_ticket', ticket);
      }
      if (ticket) {
        setIsUploadModalOpen(false);
        router.push(`/assessment/all-concepts/take?ticket=${encodeURIComponent(ticket)}`);
      } else if (hasSuccess) {
        setModalError(
          result?.quiz_error ||
            'Upload finished, but Mentora could not build a grounded GPT quiz from this material. Try clearer text-based notes.'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setModalError(message);
      setUploadResults(
        pendingFiles.map((file) => ({
          filename: file.name,
          status: 'error',
          error: message,
        }))
      );
    } finally {
      setIsUploading(false);
    }
  };

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
                <div className="group relative flex items-center rounded border border-white/25 bg-slate-800/55 shadow-sm">
                  {renameCourseId === subject.id ? (
                    <div className="flex items-center w-full min-w-0 p-2 gap-2 text-sm text-white">
                      {expandedSubjects.has(subject.id) ? (
                        <ChevronDown className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 flex-shrink-0" />
                      )}
                      <Folder className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      <input
                        autoFocus
                        value={renameCourseValue}
                        onChange={(event) => setRenameCourseValue(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveCourseRename(subject.id);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelCourseRename();
                          }
                        }}
                        className="flex-1 min-w-0 rounded border border-cyan-200/40 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300"
                      />
                      <button
                        type="button"
                        onClick={() => void saveCourseRename(subject.id)}
                        disabled={isSavingCourseRename}
                        className="px-2 py-1 rounded border border-cyan-200/40 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelCourseRename}
                        disabled={isSavingCourseRename}
                        className="px-2 py-1 rounded border border-white/30 text-white/85 hover:bg-white/10 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="flex items-center flex-1 min-w-0 p-2 rounded hover:bg-slate-700/65 transition-colors"
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
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveTopicMenuId(null);
                          setActiveCourseMenuId((prev) => (prev === subject.id ? null : subject.id));
                        }}
                        className="mr-1 rounded p-1 text-slate-200 opacity-0 transition-opacity hover:text-white hover:bg-white/10 group-hover:opacity-100 focus:opacity-100"
                        title="Course actions"
                        aria-label="Course actions"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {activeCourseMenuId === subject.id && (
                        <div
                          className="absolute right-1 top-9 z-20 w-28 rounded-md border border-white/20 bg-slate-950/95 shadow-lg"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => startCourseRename(subject.id, subject.name)}
                            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-white/90 hover:bg-white/10"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {expandedSubjects.has(subject.id) && (
                  <div className="ml-6 space-y-1 mt-1">
                    {subject.notes.map((note) => (
                      <div
                        key={note.id}
                        className="group relative flex items-center rounded-md border border-white/20 bg-slate-900/45"
                      >
                        {renameTopicId === note.id ? (
                          <div className="flex items-center flex-1 min-w-0 p-2 gap-2 rounded-md text-sm text-white">
                            <GripVertical className="w-3 h-3 text-slate-300 flex-shrink-0" />
                            <FileText className="w-4 h-4 text-white/90 flex-shrink-0" />
                            <input
                              autoFocus
                              value={renameTopicValue}
                              onChange={(event) => setRenameTopicValue(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveTopicRename(note.id);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelTopicRename();
                                }
                              }}
                              className="flex-1 min-w-0 rounded border border-cyan-200/40 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300"
                            />
                            <button
                              type="button"
                              onClick={() => void saveTopicRename(note.id)}
                              disabled={isSavingRename}
                              className="px-2 py-1 rounded border border-cyan-200/40 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelTopicRename}
                              disabled={isSavingRename}
                              className="px-2 py-1 rounded border border-white/30 text-white/85 hover:bg-white/10 disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              draggable
                              title={note.title}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('application/json', JSON.stringify({
                                  id: note.id,
                                  title: note.title,
                                  subjectName: subject.name,
                                  conceptId: note.conceptId,
                                }));
                                event.dataTransfer.effectAllowed = 'copy';
                              }}
                              className="flex items-center flex-1 min-w-0 p-2 hover:bg-slate-700/65 rounded-md text-sm cursor-grab text-white"
                              onClick={() => onNoteSelect(note.id)}
                            >
                              <GripVertical className="w-3 h-3 mr-1 text-slate-300 flex-shrink-0" />
                              <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-white/90" />
                              <span className="truncate font-medium">{note.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveCourseMenuId(null);
                                setActiveTopicMenuId((prev) => (prev === note.id ? null : note.id));
                              }}
                              className="mr-1 rounded p-1 text-slate-200 opacity-0 transition-opacity hover:text-white hover:bg-white/10 group-hover:opacity-100 focus:opacity-100"
                              title="Topic actions"
                              aria-label="Topic actions"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {activeTopicMenuId === note.id && (
                              <div
                                className="absolute right-1 top-9 z-20 w-28 rounded-md border border-white/20 bg-slate-950/95 shadow-lg"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => startTopicRename(note)}
                                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-white/90 hover:bg-white/10"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => void handleDeleteTopic(note.id, event)}
                                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-red-100 hover:bg-red-500/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isUploadModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 9999 }}
          onClick={(event) => { if (event.target === event.currentTarget) closeUploadModal(); }}
        >
          <div className="absolute inset-0 bg-black/60" />
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
                x
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-900 mb-1.5">
                Course <span className="text-red-500">*</span>
              </label>
              {modalCourses.length > 0 && (
                <select
                  value={uploadCourseId}
                  onChange={(event) => {
                    setUploadCourseId(event.target.value);
                    setNewCourseName('');
                    setNewTopicName('');
                  }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm mb-2 bg-white text-gray-900"
                  disabled={isUploading || !!newCourseName.trim()}
                >
                  {modalCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-2">
                {modalCourses.length > 0 && (
                  <span className="text-xs text-gray-600 flex-shrink-0">or create new:</span>
                )}
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(event) => {
                    setNewCourseName(event.target.value);
                    if (event.target.value.trim()) {
                      setUploadTopicId('');
                    }
                  }}
                  placeholder={modalCourses.length === 0 ? 'Course name (required)' : 'New course name...'}
                  className="flex-1 p-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder:text-gray-400"
                  disabled={isUploading}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-900 mb-1.5">
                Topic <span className="text-red-500">*</span>
              </label>
              {courseTopics.length > 0 && (
                <select
                  value={uploadTopicId}
                  onChange={(event) => {
                    setUploadTopicId(event.target.value);
                    setNewTopicName('');
                  }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm mb-2 bg-white text-gray-900"
                  disabled={isUploading || !!newTopicName.trim()}
                >
                  {courseTopics.map((topic) => (
                    <option key={`${topic.courseId}-${topic.id}`} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-2">
                {courseTopics.length > 0 && (
                  <span className="text-xs text-gray-600 flex-shrink-0">or create new:</span>
                )}
                <input
                  type="text"
                  value={newTopicName}
                  onChange={(event) => setNewTopicName(event.target.value)}
                  placeholder={courseTopics.length === 0 ? 'Topic name (required)' : 'New topic name...'}
                  className="flex-1 p-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder:text-gray-400"
                  disabled={isUploading}
                />
              </div>
            </div>

            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors mb-4 ${
                isDraggingFiles
                  ? 'border-[#03b2e6] bg-[#e0f4fb]'
                  : 'border-gray-300 hover:border-[#03b2e6]'
              }`}
              onDragOver={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}
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

            {pendingFiles.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-xs text-gray-600 mb-1">Selected files:</p>
                {pendingFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm p-1.5 rounded bg-gray-50 text-gray-900">
                    <FileText className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    <span className="flex-1 truncate" title={file.name}>{file.name}</span>
                    {!isUploading && (
                      <button
                        onClick={() => removeFile(index)}
                        className="text-gray-400 hover:text-red-500 text-xs leading-none"
                      >
                        x
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {uploadResults.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-xs text-gray-600 mb-1">Upload results:</p>
                {uploadResults.map((result, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm p-1.5 rounded bg-gray-50 border border-gray-200 text-gray-900">
                    {result.status === 'success' ? (
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="flex-1 truncate" title={result.filename}>{result.filename}</span>
                    <span className={`text-xs flex-shrink-0 ${result.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {result.status === 'success' ? `${result.chunks} chunks` : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {modalError && (
              <p className="text-xs text-red-600 mb-3">{modalError}</p>
            )}

            {pendingFiles.length > 0 && (!effectiveCourseId || (!uploadTopicId && !newTopicName.trim())) && (
              <p className="text-xs text-amber-600 mb-3">Select or create both course and topic to continue.</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeUploadModal}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900"
                disabled={isUploading}
              >
                {uploadResults.some((result) => result.status === 'success') ? 'Close' : 'Cancel'}
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
                      Uploading...
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
