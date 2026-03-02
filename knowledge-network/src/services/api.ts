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

/**
 * Fetch JSON from the backend, automatically trying fallback URLs on network errors.
 */
export async function apiFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const providedHeaders = new Headers(init?.headers ?? {});
  const isFormDataBody = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers: Record<string, string> = Object.fromEntries(providedHeaders.entries());

  if (isFormDataBody) {
    delete headers['Content-Type'];
  } else if (!('Content-Type' in headers) && !('content-type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status}: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
