/**
 * Shared API helper for communicating with the FastAPI backend.
 * All frontend services should use `apiFetch` instead of raw `fetch`.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

function getCandidateBaseUrls(): string[] {
  const candidates = [
    API_BASE_URL,
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'http://127.0.0.1:8001',
    'http://localhost:8001',
  ];
  return [...new Set(candidates)];
}

/**
 * Fetch JSON from the backend, automatically trying fallback URLs on network errors.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrls = getCandidateBaseUrls();
  let lastError: unknown = null;

  for (const base of baseUrls) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`API ${response.status}: ${detail}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof TypeError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Failed to reach API');
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

// ── Student ID helper ─────────────────────────────────────────────────────────

export function getStudentId(): string {
  if (typeof window === 'undefined') return 'student-demo';
  const existing = window.localStorage.getItem('student_id');
  if (existing) return existing;
  const created = `student-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem('student_id', created);
  return created;
}
