import { useAuth } from "@/contexts/AuthContext";

export function useStudentId(): string {
  const { user } = useAuth();
  if (!user) throw new Error("useStudentId called without authenticated user");
  return user.uid;
}
