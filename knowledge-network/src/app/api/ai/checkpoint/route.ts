import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('Authorization') || '';

    const response = await fetch(`${API_BASE}/api/tutor/checkpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('FastAPI checkpoint error:', errorData);
      return NextResponse.json({ error: 'Failed to generate checkpoint' }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error('Error in checkpoint API:', error);
    return NextResponse.json({ error: 'Failed to process checkpoint request' }, { status: 500 });
  }
}
