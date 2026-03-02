// src/services/groups.ts
import { Course } from '@/types/group';

export async function getGroups(): Promise<Course[]> {
  return [];
}

export async function getGroupDetails(groupId: string): Promise<Course | null> {
  void groupId;
  return null;
}
