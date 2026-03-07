'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useRouter } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import dynamic from 'next/dynamic';
import { normalizeTopicRow, TopicOption, UserTopicApiRow } from '@/types/topics';

const UploadCharacter3D = dynamic(
  () => import('@/components/upload/UploadCharacter3D'),
  { ssr: false }
);

interface UploadedFile {
  filename: string;
  chunks: number;
  status: 'success' | 'error';
  error?: string;
}

const toCourseId = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'course';

const toTopicId = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'topic';

export default function UploadPage() {
  const router = useRouter();
  const { apiFetchWithAuth } = useAuthedApi();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingAssessment, setIsStartingAssessment] = useState(false);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>(DEFAULT_COURSES);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [courseData, topicData] = await Promise.all([
          apiFetchWithAuth<{ courses?: CourseOption[] }>('/api/courses'),
          apiFetchWithAuth<{ topics?: UserTopicApiRow[] }>('/api/user-topics'),
        ]);

        const incomingCourses: CourseOption[] = Array.isArray(courseData.courses) ? courseData.courses : DEFAULT_COURSES;
        const incomingTopics = Array.isArray(topicData.topics)
          ? topicData.topics.map(normalizeTopicRow).filter((topic) => topic.id)
          : [];
        const dedupedTopics = Object.values(
          incomingTopics.reduce<Record<string, TopicOption>>((acc, topic) => {
            acc[`${topic.courseId}::${topic.id}`] = topic;
            return acc;
          }, {})
        );

        setCourses(incomingCourses);
        setTopics(dedupedTopics);
        if (incomingCourses.length > 0) {
          setSelectedCourse((prev) => {
            if (prev && incomingCourses.some((course) => course.id === prev)) return prev;
            return incomingCourses[0].id;
          });
        }
      } catch {
        setCourses(DEFAULT_COURSES);
        setTopics([]);
      }
    };
    load();
  }, [apiFetchWithAuth]);

  const courseTopics = useMemo(
    () => topics.filter((topic) => topic.courseId === selectedCourse),
    [selectedCourse, topics]
  );

  useEffect(() => {
    if (!selectedCourse) {
      setSelectedTopic('');
      return;
    }
    setSelectedTopic((prev) => {
      if (prev && courseTopics.some((topic) => topic.id === prev)) return prev;
      return courseTopics[0]?.id ?? '';
    });
  }, [courseTopics, selectedCourse]);

  const handleStageFiles = (files: FileList) => {
    const incoming = Array.from(files);
    setStagedFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
    });
  };

  const handleAddCourse = async () => {
    const name = newCourseName.trim();
    if (!name) return;

    const optimisticId = toCourseId(name);
    const optimisticCourse: CourseOption = { id: optimisticId, name };
    setCourses((prev) => (prev.some((course) => course.id === optimisticId) ? prev : [...prev, optimisticCourse]));
    setSelectedCourse(optimisticId);
    setSelectedTopic('');
    setNewCourseName('');
    setIsCreatingCourse(true);

    try {
      const data = await apiFetchWithAuth<{ course: CourseOption }>('/api/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      const created = data.course;
      setCourses((prev) => {
        const deduped = prev.filter((course) => course.id !== optimisticId && course.id !== created.id);
        return [...deduped, created];
      });
      setSelectedCourse(created.id);
    } catch {
      // Keep optimistic course locally if course-create API fails.
    } finally {
      setIsCreatingCourse(false);
    }
  };

  const handleAddTopic = () => {
    if (!selectedCourse) return;
    const topicName = newTopicName.trim();
    if (!topicName) return;

    const topicId = toTopicId(topicName);
    const existing = courseTopics.find(
      (topic) => topic.id === topicId || topic.name.toLowerCase() === topicName.toLowerCase()
    );
    if (existing) {
      setSelectedTopic(existing.id);
      setNewTopicName('');
      return;
    }

    const selectedCourseName = courses.find((course) => course.id === selectedCourse)?.name ?? selectedCourse;
    setTopics((prev) => [
      ...prev,
      {
        id: topicId,
        name: topicName,
        courseId: selectedCourse,
        courseName: selectedCourseName,
      },
    ]);
    setSelectedTopic(topicId);
    setNewTopicName('');
  };

  const handleUpload = async () => {
    if (stagedFiles.length === 0) return;
    setUploadError(null);
    const selectedCourseRow = courses.find((course) => course.id === selectedCourse);
    if (!selectedCourse || !selectedCourseRow) {
      setUploadError('Select a course before uploading.');
      return;
    }

    let resolvedTopicId = '';
    let resolvedTopicName = '';
    const topicDraft = newTopicName.trim();
    if (topicDraft) {
      const existing = courseTopics.find(
        (topic) => topic.name.toLowerCase() === topicDraft.toLowerCase() || topic.id === toTopicId(topicDraft)
      );
      if (existing) {
        resolvedTopicId = existing.id;
        resolvedTopicName = existing.name;
      } else {
        resolvedTopicId = toTopicId(topicDraft);
        resolvedTopicName = topicDraft;
        setTopics((prev) => {
          const exists = prev.some((topic) => topic.courseId === selectedCourse && topic.id === resolvedTopicId);
          if (exists) return prev;
          return [
            ...prev,
            {
              id: resolvedTopicId,
              name: resolvedTopicName,
              courseId: selectedCourse,
              courseName: selectedCourseRow.name,
            },
          ];
        });
      }
    } else {
      const selectedTopicRow = courseTopics.find((topic) => topic.id === selectedTopic);
      if (selectedTopicRow) {
        resolvedTopicId = selectedTopicRow.id;
        resolvedTopicName = selectedTopicRow.name;
      }
    }

    if (!resolvedTopicId || !resolvedTopicName) {
      setUploadError('Select or create a topic before uploading.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    stagedFiles.forEach((file) => formData.append('files', file));
    formData.append('course_id', selectedCourseRow.id);
    formData.append('course_name', selectedCourseRow.name);
    formData.append('topic_id', resolvedTopicId);
    formData.append('topic_name', resolvedTopicName);

    try {
      const result = await apiFetchWithAuth<{
        files?: { filename: string; chunks: number; status?: 'success' | 'error'; error?: string }[];
        comprehensive_quiz_ticket?: string;
        uploaded_concept_ids?: string[];
      }>('/upload', {
        method: 'POST',
        body: formData,
      });

      const normalized: UploadedFile[] = (result.files || []).map((file) => ({
        filename: file.filename,
        chunks: file.chunks,
        status: file.status || 'success',
        error: file.error,
      }));
      setUploadedFiles((prev) => [...prev, ...normalized]);

      const hasSuccess = normalized.some((file) => file.status === 'success');
      if (hasSuccess) {
        setStagedFiles([]);
        setIsStartingAssessment(true);
        setSelectedTopic(resolvedTopicId);
        setNewTopicName('');

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('last_uploaded_course_id', selectedCourseRow.id);
          const uploadedConceptIds = Array.isArray(result?.uploaded_concept_ids)
            ? result.uploaded_concept_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : [];
          window.sessionStorage.setItem('last_uploaded_concept_ids', JSON.stringify(uploadedConceptIds));
        }

        const ticket = typeof result?.comprehensive_quiz_ticket === 'string' ? result.comprehensive_quiz_ticket : '';
        if (ticket && typeof window !== 'undefined') {
          window.sessionStorage.setItem('comprehensive_quiz_ticket', ticket);
        }

        setTimeout(() => {
          router.push(
            ticket
              ? `/assessment/all-concepts/take?ticket=${encodeURIComponent(ticket)}`
              : '/assessment/all-concepts/take'
          );
        }, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadError(message);
      stagedFiles.forEach((file) => {
        setUploadedFiles((prev) => [...prev, { filename: file.name, chunks: 0, status: 'error', error: message }]);
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="relative min-h-full overflow-x-hidden bg-cover bg-center bg-no-repeat bg-fixed"
      style={{ backgroundImage: "url('/backgrounds/uploadback.png')" }}
    >
      <div className="nav-safe-top relative z-10 p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-white">Upload Course Materials</h1>
        <p className="text-white/70 mb-4">
          Upload your lecture notes, textbooks, and study materials. Mentora will analyze them
          to build your personalized knowledge graph.
        </p>

        <Card className="border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg text-white p-5 mb-6">
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-white/50 mb-2">
                Select Existing Course
              </label>
              <select
                value={selectedCourse}
                onChange={(event) => setSelectedCourse(event.target.value)}
                className="w-full p-2.5 rounded-lg bg-slate-800 border border-white/20 text-white focus:outline-none focus:border-[#03b2e6]/60"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id} className="bg-slate-800 text-white">{c.name}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-white/40">Files will be added to this course.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-white/50 mb-2">
                Create New Course
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(event) => setNewCourseName(event.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCourse()}
                  placeholder="e.g. Algorithms 101"
                  className="flex-1 p-2.5 rounded-lg bg-slate-800 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-[#03b2e6]/60"
                />
                <button
                  type="button"
                  onClick={handleAddCourse}
                  disabled={!newCourseName.trim() || isCreatingCourse}
                  className="px-4 py-2 rounded-lg bg-[#03b2e6] text-white font-medium hover:bg-[#029ad0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isCreatingCourse ? 'Creating...' : '+ Add'}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-white/40">Creates the course and selects it automatically.</p>
            </div>
          </div>

          <label className="block text-sm font-medium text-white/80 mt-4 mb-2">Select Topic</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedTopic}
              onChange={(event) => setSelectedTopic(event.target.value)}
              className="p-2 rounded-lg w-64 bg-slate-800 border border-white/20 text-white focus:outline-none focus:border-[#03b2e6]/60"
            >
              {courseTopics.map((topic) => (
                <option key={`${topic.courseId}-${topic.id}`} value={topic.id} className="bg-slate-900 text-white">
                  {topic.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newTopicName}
              onChange={(event) => setNewTopicName(event.target.value)}
              placeholder="Add new topic"
              className="p-2 rounded-lg w-56 bg-slate-800 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-[#03b2e6]/60"
            />
            <button
              type="button"
              onClick={handleAddTopic}
              className="px-4 py-2 rounded-full bg-[#03b2e6] text-white font-medium hover:bg-[#029ad0] transition-colors"
            >
              Add Topic
            </button>
          </div>
          {uploadError && <p className="mt-3 text-sm text-red-300">{uploadError}</p>}
        </Card>

        <Card
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors mb-6 bg-slate-900/55 backdrop-blur-sm shadow-lg ${
            isDragging ? 'border-[#03b2e6] bg-[#03b2e6]/15' : 'border-white/30 hover:border-[#03b2e6]/60'
          }`}
          onDragOver={(event: React.DragEvent) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event: React.DragEvent) => {
            event.preventDefault();
            setIsDragging(false);
            if (isCreatingCourse) return;
            handleStageFiles(event.dataTransfer.files);
          }}
        >
          <Upload className="w-12 h-12 mx-auto text-white/40 mb-4" />
          <p className="text-lg font-medium mb-2 text-white">
            {isUploading
              ? 'Uploading & processing...'
              : isStartingAssessment
                ? 'Upload complete. Starting comprehensive assessment...'
                : stagedFiles.length > 0
                  ? `${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''} ready — add more or upload`
                  : 'Drop files here or click to browse'}
          </p>
          <p className="text-sm text-white/50 mb-4">PDF, TXT, MD supported</p>
          <input
            type="file"
            className="hidden"
            id="upload-input"
            multiple
            accept=".pdf,.txt,.md"
            disabled={isCreatingCourse || isUploading}
            onChange={(event) => { if (event.target.files) { handleStageFiles(event.target.files); event.target.value = ''; } }}
          />
          <label
            htmlFor="upload-input"
            className={`inline-block px-6 py-2 rounded-full font-medium transition-colors ${
              isCreatingCourse || isUploading
                ? 'bg-slate-500/70 text-white/80 cursor-not-allowed'
                : 'bg-white/15 border border-white/30 text-white cursor-pointer hover:bg-white/25'
            }`}
          >
            {isCreatingCourse ? 'Saving Course...' : 'Browse Files'}
          </label>
        </Card>

        {stagedFiles.length > 0 && !isUploading && !isStartingAssessment && (
          <Card className="p-4 mb-4 border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg text-white">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Files to Upload</h3>
              <button
                type="button"
                onClick={() => setStagedFiles([])}
                className="text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-2 mb-4">
              {stagedFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                  <FileText className="w-4 h-4 text-white/50 flex-shrink-0" />
                  <span className="flex-1 text-white/90 text-sm truncate">{file.name}</span>
                  <span className="text-xs text-white/40">{(file.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => setStagedFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-white/40 hover:text-white/80 transition-colors ml-1"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleUpload}
              disabled={isCreatingCourse}
              className="w-full py-2.5 rounded-full font-medium bg-[#03b2e6] text-white hover:bg-[#029ad0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Upload {stagedFiles.length} File{stagedFiles.length > 1 ? 's' : ''}
            </button>
          </Card>
        )}

        {uploadedFiles.length > 0 && (
          <Card className="p-4 mb-6 border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg text-white">
            <h3 className="font-semibold mb-3 text-white">Uploaded Files</h3>
            <div className="space-y-2">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                  <FileText className="w-4 h-4 text-white/50" />
                  <span className="flex-1 text-white/90">{file.filename}</span>
                  {file.status === 'success' ? (
                    <span className="flex items-center gap-1 text-sm text-emerald-400">
                      <CheckCircle className="w-4 h-4" /> {file.chunks} chunks processed
                    </span>
                  ) : (
                    <div className="text-right">
                      <span className="flex items-center gap-1 text-sm text-red-400 justify-end">
                        <AlertCircle className="w-4 h-4" /> Upload failed
                      </span>
                      {file.error ? <p className="text-xs text-red-400/80 max-w-[360px]">{file.error}</p> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg">
          <div className="flex gap-3">
            <BookOpen className="w-5 h-5 text-[#4cc9f0] mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-white">What happens next?</h3>
              <p className="text-sm text-white/60 mt-1">
                Mentora extracts key concepts and builds prerequisite relationships
                to create your knowledge graph. Once processed, view it on your{' '}
                <Link href="/knowledge-map" className="underline font-medium text-[#4cc9f0] hover:text-[#03b2e6] transition-colors">
                  Knowledge Map
                </Link>.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <UploadCharacter3D className="pointer-events-none absolute bottom-4 right-4 z-20 h-[320px] w-[260px] transform -translate-y-[20%] block" />
    </div>
  );
}
