'use client';

import React, { useEffect, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useRouter } from 'next/navigation';
import { useAuthedApi } from '@/hooks/useAuthedApi';

interface UploadedFile {
  filename: string;
  chunks: number;
  status: 'success' | 'error';
}

export default function UploadPage() {
  const router = useRouter();
  const { authedFetch } = useAuthedApi();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingAssessment, setIsStartingAssessment] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>(DEFAULT_COURSES);
  const [selectedCourse, setSelectedCourse] = useState('physics-101');
  const [newCourseName, setNewCourseName] = useState('');

  const getApiBase = () => {
    const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return 'http://localhost:8000';
    }
  };

  useEffect(() => {
    const base = getApiBase();
    const load = async () => {
      try {
        const res = await authedFetch(`${base}/api/courses`);
        if (!res.ok) throw new Error('Failed to load courses');
        const data = await res.json();
        const incoming: CourseOption[] = Array.isArray(data.courses) ? data.courses : DEFAULT_COURSES;
        setCourses(incoming);
        if (incoming.length > 0) setSelectedCourse(incoming[0].id);
      } catch {
        setCourses(DEFAULT_COURSES);
      }
    };
    load();
  }, [authedFetch]);

  const handleUpload = async (files: FileList) => {
    setIsUploading(true);
    const base = getApiBase();
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));
    const selected = courses.find((c) => c.id === selectedCourse);
    formData.append('course_id', selectedCourse);
    if (selected) formData.append('course_name', selected.name);

    try {
      const response = await authedFetch(`${base}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const result = await response.json();
      const normalized: UploadedFile[] = (result.files || []).map(
        (f: { filename: string; chunks: number; status?: 'success' | 'error' }) => ({
          filename: f.filename,
          chunks: f.chunks,
          status: f.status || 'success',
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
    } catch {
      Array.from(files).forEach(file => {
        setUploadedFiles(prev => [...prev, { filename: file.name, chunks: 0, status: 'error' }]);
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddCourse = () => {
    const name = newCourseName.trim();
    if (!name) return;
    const base = getApiBase();
    const create = async () => {
      try {
        const res = await authedFetch(`${base}/api/courses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error('Failed to create course');
        const data = await res.json();
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
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Upload Course Materials</h1>
      <p className="text-gray-500 mb-6">
        Upload your lecture notes, textbooks, and study materials. LearnGraph AI will analyze them
        to build your personalized knowledge graph.
      </p>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Course</label>
        <div className="flex flex-wrap items-center gap-2">
          <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
            className="p-2 border rounded-lg w-64">
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            type="text"
            value={newCourseName}
            onChange={(e) => setNewCourseName(e.target.value)}
            placeholder="Add new course"
            className="p-2 border rounded-lg w-56"
          />
          <button
            type="button"
            onClick={handleAddCourse}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Add Course
          </button>
        </div>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors mb-6 ${
          isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400'
        }`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleUpload(e.dataTransfer.files); }}
      >
        <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
        <p className="text-lg font-medium mb-2">
          {isUploading
            ? 'Uploading & processing...'
            : isStartingAssessment
              ? 'Upload complete. Starting assessment...'
              : 'Drop files here or click to upload'}
        </p>
        <p className="text-sm text-gray-500 mb-4">PDF, DOCX, TXT, MD supported</p>
        <input type="file" className="hidden" id="upload-input" multiple
          accept=".pdf,.doc,.docx,.txt,.md"
          onChange={e => e.target.files && handleUpload(e.target.files)} />
        <label htmlFor="upload-input"
          className="inline-block px-6 py-2 bg-emerald-600 text-white rounded-lg cursor-pointer hover:bg-emerald-700">
          Browse Files
        </label>
      </div>

      {uploadedFiles.length > 0 && (
        <Card className="p-4 mb-6">
          <h3 className="font-semibold mb-3">Uploaded Files</h3>
          <div className="space-y-2">
            {uploadedFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-50">
                <FileText className="w-4 h-4 text-gray-500" />
                <span className="flex-1">{file.filename}</span>
                {file.status === 'success' ? (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4" /> {file.chunks} chunks processed
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" /> Upload failed
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 bg-emerald-50 border-emerald-200">
        <div className="flex gap-3">
          <BookOpen className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-emerald-800">What happens next?</h3>
            <p className="text-sm text-emerald-700 mt-1">
              LearnGraph AI extracts key concepts and builds prerequisite relationships
              to create your knowledge graph. Once processed, view it on your{' '}
              <Link href="/knowledge-map" className="underline font-medium">Knowledge Map</Link>.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
