/**
 * Shared API helper for communicating with the FastAPI backend.
 * All frontend services should use `apiFetch` instead of raw `fetch`.
 */

const RAW_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

function sanitizeApiBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'http://127.0.0.1:8000';
  }
}

const API_BASE_URL = sanitizeApiBaseUrl(RAW_API_BASE_URL);

function getCandidateBaseUrls(): string[] {
  const runtimeHost =
    typeof window !== 'undefined' && window.location?.hostname
      ? `http://${window.location.hostname}:8000`
      : null;
  const candidates = [
    API_BASE_URL,
    ...(runtimeHost ? [runtimeHost] : []),
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
export async function apiFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const baseUrls = getCandidateBaseUrls();
  let lastError: unknown = null;

  for (const base of baseUrls) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> || {}),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${base}${path}`, {
        ...init,
        headers,
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
