'use client';

import React, { useEffect, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useRouter } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import dynamic from 'next/dynamic';

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

export default function UploadPage() {
  const router = useRouter();
  const { apiFetchWithAuth } = useAuthedApi();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingAssessment, setIsStartingAssessment] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>(DEFAULT_COURSES);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [newCourseName, setNewCourseName] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetchWithAuth<{ courses?: CourseOption[] }>('/api/courses');
        const incoming: CourseOption[] = Array.isArray(data.courses) ? data.courses : DEFAULT_COURSES;
        setCourses(incoming);
        if (incoming.length > 0) setSelectedCourse(incoming[0].id);
      } catch {
        setCourses(DEFAULT_COURSES);
      }
    };
    load();
  }, [apiFetchWithAuth]);

  const handleUpload = async (files: FileList) => {
    setIsUploading(true);
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));
    const selected = courses.find((c) => c.id === selectedCourse);
    formData.append('course_id', selectedCourse);
    if (selected) formData.append('course_name', selected.name);

    try {
      const result = await apiFetchWithAuth<{
        files?: { filename: string; chunks: number; status?: 'success' | 'error'; error?: string }[];
        suggested_quiz_concept?: string;
      }>('/upload', {
        method: 'POST',
        body: formData,
      });
      const normalized: UploadedFile[] = (result.files || []).map(
        (f: { filename: string; chunks: number; status?: 'success' | 'error'; error?: string }) => ({
          filename: f.filename,
          chunks: f.chunks,
          status: f.status || 'success',
          error: f.error,
        })
      );
      setUploadedFiles(prev => [...prev, ...normalized]);

      const hasSuccess = normalized.some(file => file.status === 'success');
      if (hasSuccess) {
        const quizConcept =
          typeof result?.suggested_quiz_concept === 'string' && result.suggested_quiz_concept.trim()
            ? result.suggested_quiz_concept.trim()
            : '';
        if (quizConcept) {
          setIsStartingAssessment(true);
          setTimeout(() => {
            router.push(`/assessment/${quizConcept}/take`);
          }, 500);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      Array.from(files).forEach(file => {
        setUploadedFiles(prev => [...prev, { filename: file.name, chunks: 0, status: 'error', error: message }]);
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddCourse = () => {
    const name = newCourseName.trim();
    if (!name) return;
    const create = async () => {
      try {
        const data = await apiFetchWithAuth<{ course: CourseOption }>('/api/courses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });
        const created: CourseOption = data.course;
        const deduped = courses.filter((c) => c.id !== created.id);
        const next = [...deduped, created];
        setCourses(next);
        setSelectedCourse(created.id);
        setNewCourseName('');
      } catch {
        // no-op UI fallback for now
      }
    };
    create();
  };

  return (
    <div
      className="relative min-h-full overflow-x-hidden bg-cover bg-center bg-no-repeat bg-fixed"
      style={{ backgroundImage: "url('/backgrounds/uploadback.png')" }}
    >
    <div className="relative z-10 p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-black">Upload Course Materials</h1>
      <p className="text-black/70 mb-4">
        Upload your lecture notes, textbooks, and study materials. Mentora will analyze them
        to build your personalized knowledge graph.
      </p>

      <Card className="border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg text-white p-5 mb-6">
        <label className="block text-sm font-medium text-white/80 mb-2">Select Course</label>
        <div className="flex flex-wrap items-center gap-2">
          <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
            className="p-2 rounded-lg w-64 bg-white/10 border border-white/20 text-white focus:outline-none focus:border-[#03b2e6]/60">
            {courses.map(c => <option key={c.id} value={c.id} className="bg-slate-900 text-white">{c.name}</option>)}
          </select>
          <input
            type="text"
            value={newCourseName}
            onChange={(e) => setNewCourseName(e.target.value)}
            placeholder="Add new course"
            className="p-2 rounded-lg w-56 bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-[#03b2e6]/60"
          />
          <button
            type="button"
            onClick={handleAddCourse}
            className="px-4 py-2 rounded-full bg-[#03b2e6] text-white font-medium hover:bg-[#029ad0] transition-colors"
          >
            Add Course
          </button>
        </div>
      </Card>

      <Card
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors mb-6 bg-slate-900/55 backdrop-blur-sm shadow-lg ${
          isDragging ? 'border-[#03b2e6] bg-[#03b2e6]/15' : 'border-white/30 hover:border-[#03b2e6]/60'
        }`}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); handleUpload(e.dataTransfer.files); }}
      >
        <Upload className="w-12 h-12 mx-auto text-white/40 mb-4" />
        <p className="text-lg font-medium mb-2 text-white">
          {isUploading
            ? 'Uploading & processing...'
            : isStartingAssessment
              ? 'Upload complete. Starting assessment...'
              : 'Drop files here or click to upload'}
        </p>
        <p className="text-sm text-white/50 mb-4">PDF, TXT, MD supported</p>
        <input type="file" className="hidden" id="upload-input" multiple
          accept=".pdf,.txt,.md"
          onChange={e => e.target.files && handleUpload(e.target.files)} />
        <label htmlFor="upload-input"
          className="inline-block px-6 py-2 bg-[#03b2e6] text-white rounded-full cursor-pointer hover:bg-[#029ad0] font-medium transition-colors">
          Browse Files
        </label>
      </Card>

      {uploadedFiles.length > 0 && (
        <Card className="p-4 mb-6 border-white/20 bg-slate-900/55 backdrop-blur-sm shadow-lg text-white">
          <h3 className="font-semibold mb-3 text-white">Uploaded Files</h3>
          <div className="space-y-2">
            {uploadedFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
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

      <Card className="p-4 border-[#03b2e6]/30 bg-[#03b2e6]/10 backdrop-blur-sm shadow-lg">
        <div className="flex gap-3">
          <BookOpen className="w-5 h-5 text-[#4cc9f0] mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-white">What happens next?</h3>
            <p className="text-sm text-white/60 mt-1">
              Mentora extracts key concepts and builds prerequisite relationships
              to create your knowledge graph. Once processed, view it on your{' '}
              <Link href="/knowledge-map" className="underline font-medium text-[#4cc9f0] hover:text-[#03b2e6] transition-colors">Knowledge Map</Link>.
            </p>
          </div>
        </div>
      </Card>
    </div>

    <UploadCharacter3D className="pointer-events-none absolute bottom-4 right-4 z-20 h-[320px] w-[260px] transform -translate-y-[20%] block" />
    </div>
  );
}
