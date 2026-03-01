import { User } from '@/types/user';

export async function getUserProfile(userId: string): Promise<User> {
  // Replace with actual API call
  return {
    id: userId,
    name: "John Smith",
    major: "Computer Science",
    courses: ["CS201", "PHY101"],
    progress: {
      "CS201": 75,
      "PHY101": 82
    }
  };
}