import { User } from '@/types/user';

export async function getUserProfile(userId: string): Promise<User> {
  return {
    id: userId,
    name: userId,
    major: "",
    courses: [],
    progress: {},
  };
}
