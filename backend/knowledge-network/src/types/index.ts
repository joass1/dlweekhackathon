export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subject {
  id: string;
  name: string;  // This will be the course name (e.g., "Mathematics", "Physics", etc.)
  notes: Note[];
} 