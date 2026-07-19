const requests = new Map<string, { count: number; resetsAt: number }>();
export function checkAnalyticsRateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now(); const current = requests.get(key);
  if (!current || current.resetsAt <= now) { requests.set(key, { count: 1, resetsAt: now + windowMs }); return { allowed: true, retryAfterSeconds: 0 }; }
  if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1000)) };
  current.count += 1; return { allowed: true, retryAfterSeconds: 0 };
}
