import 'next-auth';

declare module 'next-auth' {
  interface User {
    id: string;
    recentTopics: string[];
    currentSubject: string;
  }

  interface Session {
    user: User & {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
} 