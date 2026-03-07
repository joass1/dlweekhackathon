import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const API_BASE =
  process.env.API_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || 'http://127.0.0.1:8000';

interface RecommendationCandidate {
  concept_id: string;
  title: string;
  mastery: number;
  status: string;
  unlock_count: number;
  prerequisite_count: number;
  has_decay: boolean;
  rank_hint: number;
}

interface RecommendationRequestBody {
  course_name?: string;
  candidates?: RecommendationCandidate[];
  attention_summary?: {
    weak_count?: number;
    learning_count?: number;
  };
}

interface RecommendationResponse {
  concept_id: string;
  title: string;
  summary: string;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
  disclaimer: string;
  provider?: string;
  model?: string;
}

function isRecommendationResponse(value: unknown): value is RecommendationResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.concept_id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && Array.isArray(candidate.reasons)
    && candidate.reasons.every((reason) => typeof reason === 'string')
    && (candidate.confidence === 'high' || candidate.confidence === 'medium' || candidate.confidence === 'low')
    && typeof candidate.disclaimer === 'string'
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RecommendationRequestBody;
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 8) : [];
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'At least one recommendation candidate is required.' },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get('Authorization') || '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let backendResponse: Response;
    try {
      backendResponse = await fetch(`${API_BASE}/api/tutor/recommend-next-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          course_name: body.course_name ?? 'All Courses',
          candidates,
          attention_summary: body.attention_summary ?? {},
        }),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Recommendation request timed out. Please try again.' },
          { status: 504 }
        );
      }
      throw fetchError;
    }
    clearTimeout(timeoutId);

    if (!backendResponse.ok) {
      const detail = await backendResponse.text();
      console.error('Backend recommendation error:', detail);
      return NextResponse.json(
        { error: 'Backend recommendation request failed.' },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json() as unknown;
    if (!isRecommendationResponse(data)) {
      return NextResponse.json(
        { error: 'Backend recommendation payload was invalid.' },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Recommendation route error:', error);
    return NextResponse.json(
      { error: 'Failed to generate recommendation.' },
      { status: 500 }
    );
  }
}
