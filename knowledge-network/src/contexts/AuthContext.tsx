"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  multiFactor,
  type User,
} from "firebase/auth";
import Image from "next/image";
import { auth } from "@/lib/firebase-auth";
import { useRouter, usePathname } from "next/navigation";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isMfaEnrolled: boolean;
  skipRedirect: boolean;
  setSkipRedirect: (v: boolean) => void;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isMfaEnrolled: false,
  skipRedirect: false,
  setSkipRedirect: () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [skipRedirect, setSkipRedirect] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Route guard: redirect unauthenticated users to sign-in
  useEffect(() => {
    if (loading || skipRedirect) return;
    if (!user && pathname !== "/auth/signin") {
      router.replace("/auth/signin");
    }
    if (user && pathname === "/auth/signin") {
      router.replace("/");
    }
  }, [user, loading, skipRedirect, pathname, router]);

  const signOut = async () => {
    await firebaseSignOut(auth);
    router.replace("/auth/signin");
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!user) return null;
    return user.getIdToken();
  };

  const isMfaEnrolled = user
    ? multiFactor(user).enrolledFactors.length > 0
    : false;

  // Don't render protected pages until auth resolves and user is available
  // (or we're already on the sign-in page)
  const isAuthPage = pathname === "/auth/signin";
  const showChildren = !loading && (user || isAuthPage);

  return (
    <AuthContext.Provider value={{ user, loading, isMfaEnrolled, skipRedirect, setSkipRedirect, signOut, getIdToken }}>
      {showChildren ? (
        children
      ) : (
        <div className="flex items-center justify-center min-h-screen">
          <Image
            src="/logo-images/favicon.png"
            alt="Loading"
            width={56}
            height={56}
            className="animate-bounce"
            priority
          />
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
