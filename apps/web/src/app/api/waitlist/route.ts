/**
 * Waitlist capture.
 *
 * Two rules govern this file:
 *
 *   1. The email address is written to the store and nowhere else. It is never
 *      logged, never echoed back in a response, and never included in an error
 *      message — not on a validation failure, not on a write failure. Every
 *      `console` call below is deliberately record-free.
 *   2. The response is identical whether the address is new or already
 *      present. A submission must not be usable as an oracle for whether some
 *      address is on the list.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';

// Required: this route touches the filesystem, which the Edge runtime has no
// access to.
export const runtime = 'nodejs';

const QUALIFIERS = new Set(['agent', 'wallet', 'protocol', 'looking']);

/**
 * Deliberately loose, and identical to the client-side check. Neither side is
 * deciding whether an address is deliverable — only rejecting input that is
 * obviously not an address. Anything stricter rejects valid addresses.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL = 254;
const MAX_HANDLE = 64;

/**
 * TODO(roadmap): a real backend. This is a JSON file, which means it is
 * single-node, unlocked against concurrent writes, and — on a serverless host,
 * where the default lands in the instance's temp directory — erased when the
 * instance is recycled. It is enough to prove the flow end to end and nothing
 * more. Set `WAITLIST_STORE_PATH` to keep entries somewhere durable until this
 * is replaced.
 *
 * The path is assembled by interpolation rather than `path.join`: the build's
 * file tracer treats a `path.join` in a route as evidence that the module
 * resolves files dynamically, and responds by tracing the whole project into
 * the function bundle. Reading and writing a non-literal path still trips the
 * same heuristic, so `next build` emits one "unexpected file in NFT list"
 * warning naming this route. It is a bundle-size warning, not a fault, and it
 * is inherent to a file-backed store; it goes away with the store.
 */
const STORE_PATH = process.env.WAITLIST_STORE_PATH ?? `${os.tmpdir()}/limen-waitlist.json`;

interface WaitlistEntry {
  email: string;
  qualifier: string;
  handle: string | null;
  at: string;
}

/* --- rate limit ---------------------------------------------------------- */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

/**
 * Fixed window, per IP, in memory.
 *
 * TODO(roadmap): shared state. Process-local counters reset on redeploy and do
 * not compose across instances, so this raises the cost of a flood rather than
 * bounding it. It moves to the same backing store as the entries themselves.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string, now: number): boolean {
  // Opportunistic sweep, so the map cannot grow without bound across a long
  // process lifetime.
  if (hits.size > 4096) {
    for (const [key, window] of hits) if (window.resetAt <= now) hits.delete(key);
  }

  const window = hits.get(ip);
  if (window === undefined || window.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  window.count += 1;
  return window.count > MAX_PER_WINDOW;
}

/**
 * The first hop in `x-forwarded-for` is the client as far as the proxy in
 * front of this app is concerned. Spoofable when the app is reachable without
 * that proxy; sufficient for throttling a form.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/* --- store --------------------------------------------------------------- */

async function readStore(): Promise<WaitlistEntry[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WaitlistEntry[]) : [];
  } catch {
    // Missing or unreadable: start a new list rather than failing the
    // submission.
    return [];
  }
}

async function record(entry: WaitlistEntry): Promise<void> {
  const entries = await readStore();
  // A repeat submission updates nothing and is not reported to the caller.
  if (!entries.some((existing) => existing.email === entry.email)) entries.push(entry);
  // The containing directory is expected to exist — the temp directory always
  // does, and an operator setting `WAITLIST_STORE_PATH` is choosing a location
  // they have already provisioned.
  await fs.writeFile(STORE_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

/* --- handler ------------------------------------------------------------- */

function bad(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  if (rateLimited(clientIp(request), now)) {
    return bad('Too many submissions from this address. Try again later.', 429);
  }

  let body: { email?: unknown; qualifier?: unknown; handle?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad('Request body must be JSON.', 400);
  }

  // Validated here as well as in the browser: the client check is a courtesy
  // to the user, not a constraint on what reaches the store.
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email.length === 0 || email.length > MAX_EMAIL || !EMAIL.test(email)) {
    return bad('Enter a valid email address.', 400);
  }

  const qualifier = typeof body.qualifier === 'string' ? body.qualifier : '';
  if (!QUALIFIERS.has(qualifier)) return bad('Select what you are building.', 400);

  const rawHandle = typeof body.handle === 'string' ? body.handle.trim() : '';
  if (rawHandle.length > MAX_HANDLE) return bad('That handle is too long.', 400);
  const handle = rawHandle.length > 0 ? rawHandle : null;

  try {
    await record({ email, qualifier, handle, at: new Date(now).toISOString() });
  } catch (error) {
    // The message may name the store path; it can never name the submission.
    console.error(
      `waitlist: write failed (${error instanceof Error ? error.message : 'unknown error'})`,
    );
    return bad('Could not record that. Try again.', 503);
  }

  // Identical for a new address and one already on the list.
  return Response.json({ ok: true });
}
