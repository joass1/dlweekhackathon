export interface Note {
  id: string;
  title: string;
}

export interface Subject {
  id: string;
  name: string;
  notes: Note[];
} 