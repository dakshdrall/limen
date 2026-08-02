/**
 * Fixed-window rate limiting, per key, in memory.
 *
 * TODO(roadmap): shared state. Process-local counters reset on redeploy and do
 * not compose across instances, so this raises the cost of a flood rather than
 * bounding it. It moves to a real backing store alongside the waitlist entries.
 *
 * In-memory is a deliberate choice for now rather than an oversight: it
 * survives a cold start with no new dependency and no provisioning step, which
 * is the constraint this MVP is deployed under. The honest accounting is in the
 * README.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimit {
  /** True when this call exceeds the budget and should be refused. */
  check(key: string, now?: number): boolean;
}

/**
 * `max` calls per `windowMs`, keyed by whatever the caller passes — an IP for
 * public endpoints, a constant for a global ceiling.
 */
export function createRateLimit({
  max,
  windowMs,
  maxKeys = 4096,
}: {
  max: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimit {
  const windows = new Map<string, Window>();

  return {
    check(key: string, now: number = Date.now()): boolean {
      // Opportunistic sweep, so the map cannot grow without bound across a long
      // process lifetime.
      if (windows.size > maxKeys) {
        for (const [existing, window] of windows) {
          if (window.resetAt <= now) windows.delete(existing);
        }
      }

      const window = windows.get(key);
      if (window === undefined || window.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      window.count += 1;
      return window.count > max;
    },
  };
}

/**
 * The first hop in `x-forwarded-for` is the client as far as the proxy in front
 * of this app is concerned. Spoofable when the app is reachable without that
 * proxy; sufficient for throttling a public endpoint.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return request.headers.get('x-real-ip') ?? 'unknown';
}
