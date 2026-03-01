"use client";

import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/services/api";

export function useAuthedApi() {
  const { getIdToken } = useAuth();

  const apiFetchWithAuth = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getIdToken();
      return apiFetch<T>(path, init, token);
    },
    [getIdToken]
  );

  const authedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const token = await getIdToken();
      const headers = new Headers(init?.headers ?? {});
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, {
        ...init,
        headers,
      });
    },
    [getIdToken]
  );

  return { apiFetchWithAuth, authedFetch };
}
