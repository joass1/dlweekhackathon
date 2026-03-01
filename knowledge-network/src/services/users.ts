import { User } from '@/types/user';

export async function getUserProfile(userId: string): Promise<User> {
  // Stub — returns minimal profile. Real data comes from Firebase Auth via useAuth().
  return {
    id: userId,
    name: "Student",
    major: "",
    courses: [],
    progress: {},
  };
}
