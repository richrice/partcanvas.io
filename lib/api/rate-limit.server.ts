// In-memory token buckets (D12). Known limitation, by design: state is
// per-process, which matches the single-replica deployment; revisit only if
// the app ever scales out.

export interface RateLimitRule {
  capacity: number;
  refillPerSecond: number;
}

// Compile-heavy anonymous endpoints, per IP.
export const COMPILE_RULE: RateLimitRule = { capacity: 60, refillPerSecond: 1 };
// Publishing (compiles server-side and writes revisions), per user.
export const PUBLISH_RULE: RateLimitRule = { capacity: 12, refillPerSecond: 12 / 3600 };
// Cheap social mutations (like, fork, download beacon, username), per user/IP.
export const SOCIAL_RULE: RateLimitRule = { capacity: 60, refillPerSecond: 0.5 };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

export function resetRateLimitsForTests() {
  buckets.clear();
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitDecision {
  const bucket = buckets.get(key) ?? { tokens: rule.capacity, updatedAt: now };
  bucket.tokens = Math.min(rule.capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) / 1000 * rule.refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  buckets.set(key, bucket);
  // Unbounded-growth backstop: drop replenished buckets when the map bloats.
  if (buckets.size > MAX_BUCKETS) {
    for (const [existingKey, existing] of buckets) {
      if (existing.tokens >= 1 && existingKey !== key) buckets.delete(existingKey);
      if (buckets.size <= MAX_BUCKETS / 2) break;
    }
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / rule.refillPerSecond)) };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitResponse(decision: RateLimitDecision, headers: Record<string, string> = {}): Response {
  return Response.json({ error: "Rate limit exceeded — slow down and retry shortly" }, {
    status: 429,
    headers: { "retry-after": String(decision.retryAfterSeconds), "cache-control": "no-store", ...headers },
  });
}
