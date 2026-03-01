import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';

// TypeScript interfaces
interface FileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  content: string;
}

interface IconProps {
  className?: string;
}

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
} as const;

// Helper Icons
const FileIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

const TrashIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const UploadIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);

const BackIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

// Preview Modal Component
const PreviewModal = ({ file, onClose }: { file: FileItem; onClose: () => void }) => {
  const getPreviewContent = () => {
    if (file.type.startsWith('image/')) {
      return <img src={file.content} alt={file.name} className="max-w-full max-h-[70vh] object-contain" />;
    }
    if (file.type === 'application/pdf') {
      return <iframe src={file.content} className="w-full h-[70vh]" />;
    }
    if (file.type.startsWith('text/')) {
      return (
        <div className="bg-gray-800 p-4 rounded-lg overflow-auto max-h-[70vh]">
          <pre className="text-gray-300 whitespace-pre-wrap">{atob(file.content.split(',')[1])}</pre>
        </div>
      );
    }
    return <div className="text-gray-300">Preview not available for this file type</div>;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-white">{file.name}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex justify-center">
          {getPreviewContent()}
        </div>
      </div>
    </div>
  );
};

// File Card Component
const FileCard = ({ file, onDelete, onPreview }: { 
  file: FileItem; 
  onDelete: (id: string) => void;
  onPreview: (file: FileItem) => void;
}) => (
  <div className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition-colors group">
    <div className="flex items-start justify-between">
      <button
        onClick={() => onPreview(file)}
        className="flex items-center gap-3 flex-1 text-left"
      >
        <div className="w-10 h-10 bg-violet-500/20 rounded-lg flex items-center justify-center">
          <FileIcon className="w-6 h-6 text-violet-500" />
        </div>
        <div>
          <h3 className="text-white font-medium truncate max-w-[200px]">{file.name}</h3>
          <p className="text-sm text-gray-400">{formatFileSize(file.size)}</p>
        </div>
      </button>
      <button
        onClick={() => onDelete(file.id)}
        className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <TrashIcon className="w-5 h-5" />
      </button>
    </div>
  </div>
);

// File Manager Component
const FileManager = ({ subject }: { subject: string }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  useEffect(() => {
    const savedFiles = localStorage.getItem(`files-${subject}`);
    if (savedFiles) {
      setFiles(JSON.parse(savedFiles));
    }
  }, [subject]);

  useEffect(() => {
    localStorage.setItem(`files-${subject}`, JSON.stringify(files));
  }, [files, subject]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setUploading(true);
    
    Promise.all(acceptedFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            id: Math.random().toString(36).substring(7),
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: new Date().toISOString(),
            content: reader.result as string,
          });
        };
        reader.readAsDataURL(file);
      });
    })).then((newFiles) => {
      setFiles(prev => [...prev, ...newFiles as FileItem[]]);
      setUploading(false);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this file?')) {
      setFiles(prev => prev.filter(file => file.id !== id));
    }
  };

  return (
    <div>
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-8 mb-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-violet-500 bg-violet-500/10' : 'border-gray-700 hover:border-gray-600'}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <UploadIcon className="w-12 h-12 text-gray-500" />
          <div>
            <p className="text-white font-medium">
              {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
          </div>
        </div>
      </div>

      {uploading && (
        <div className="mb-8 flex items-center gap-4 p-4 bg-violet-500/10 rounded-lg">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-violet-500">Uploading files...</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {files.map(file => (
          <FileCard 
            key={file.id} 
            file={file} 
            onDelete={handleDelete}
            onPreview={setPreviewFile}
          />
        ))}
      </div>

      {previewFile && (
        <PreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

// Helper function for formatting file sizes
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Main Subject Page Component
const SubjectPage = ({ subject }: { subject: keyof typeof SUBJECTS }) => {
  const navigate = useNavigate();
  const subjectConfig = SUBJECTS[subject];

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-violet-500 hover:text-violet-400 mb-8 transition-colors"
        >
          <BackIcon className="w-5 h-5" />
          Back to Dashboard
        </button>
        
        <h1 className="text-3xl font-bold text-white mb-2">{subjectConfig.title}</h1>
        <p className="text-gray-400 mb-8">{subjectConfig.description}</p>
        
        <FileManager subject={subject} />
      </div>
    </div>
  );
};

// Export individual pages
export const DSAPage = () => <SubjectPage subject="dsa" />;
export const FluidMechanicsPage = () => <SubjectPage subject="fluid-mechanics" />;
export const DifferentialEquationsPage = () => <SubjectPage subject="differential-equations" />;

export default SubjectPage;