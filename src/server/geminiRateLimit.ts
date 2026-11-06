// Best-effort Gemini call budget, kept in server memory.
//
// Each server instance keeps its own counters and a cold start resets them, so
// this caps abuse from a single client but is not a hard spending limit. For a
// hard ceiling, also set a quota or budget on the Gemini API key itself.
//
// When a budget is exhausted, callers skip Gemini and use their non-AI fallback,
// so the app keeps working.

type Bucket = { count: number; resetAt: number };

const CLIENT_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 5000;

// One /api/analyze request costs 1 call; one swipe batch costs up to 10.
const CLIENT_LIMIT = readLimit('GEMINI_CLIENT_LIMIT', 60);
const GLOBAL_LIMIT = readLimit('GEMINI_DAILY_LIMIT', 1000);

const clientBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: 0 };

function readLimit(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function clientKeyFromRequest(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Reserves one Gemini call for this client. Returns false when over budget. */
export function tryConsumeGeminiCall(clientKey: string, now = Date.now()): boolean {
  if (now >= globalBucket.resetAt) {
    globalBucket = { count: 0, resetAt: now + GLOBAL_WINDOW_MS };
  }
  if (globalBucket.count >= GLOBAL_LIMIT) return false;

  let bucket = clientBuckets.get(clientKey);
  if (!bucket || now >= bucket.resetAt) {
    pruneClientBuckets(now);
    bucket = { count: 0, resetAt: now + CLIENT_WINDOW_MS };
    clientBuckets.set(clientKey, bucket);
  }
  if (bucket.count >= CLIENT_LIMIT) return false;

  bucket.count += 1;
  globalBucket.count += 1;
  return true;
}

function pruneClientBuckets(now: number) {
  if (clientBuckets.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, bucket] of clientBuckets) {
    if (now >= bucket.resetAt) clientBuckets.delete(key);
  }
  // Still full: drop the oldest entries (Map keeps insertion order).
  for (const key of clientBuckets.keys()) {
    if (clientBuckets.size < MAX_TRACKED_CLIENTS) break;
    clientBuckets.delete(key);
  }
}
