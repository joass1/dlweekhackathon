export interface User {
    id: string;
    name: string;
    major: string;
    courses: string[];
    progress: {
      [courseId: string]: number;
    };
  }