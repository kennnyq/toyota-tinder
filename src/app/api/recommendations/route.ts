import { NextResponse } from 'next/server';
import { getCsvCars } from '@/data/csvCars.server';
import { buildRecommendations } from '@/server/recommendationEngine';
import { clientKeyFromRequest, tryConsumeGeminiCall } from '@/server/geminiRateLimit';
import { UserFilter } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    const userFilter = payload.userFilter as UserFilter | undefined;
    if (!userFilter) {
      return NextResponse.json({ error: 'userFilter is required' }, { status: 400 });
    }
    const limit = typeof payload.limit === 'number' ? payload.limit : undefined;
    const listings = getCsvCars();
    const clientKey = clientKeyFromRequest(req);
    const results = await buildRecommendations({
      sessionId,
      userFilter,
      listings,
      limit,
      allowGeminiCall: () => tryConsumeGeminiCall(clientKey),
    });
    return NextResponse.json({ sessionId, results });
  } catch (error) {
    console.error('recommendations POST failed', error);
    return NextResponse.json({ error: 'Failed to build recommendations' }, { status: 500 });
  }
}
