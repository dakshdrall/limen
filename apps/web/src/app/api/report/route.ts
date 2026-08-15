/**
 * Where an error report goes.
 *
 * The browser posts here and this forwards to a webhook. A route in the middle
 * rather than posting to the webhook directly, for two reasons that are both
 * load-bearing:
 *
 *   1. **The webhook URL stays server-side.** A webhook URL is a credential —
 *      anyone holding it can post to the channel it addresses. In the client
 *      bundle it would be world-readable and the first thing found by anyone
 *      who looked, and `LIMEN_ERROR_WEBHOOK` is deliberately not
 *      `NEXT_PUBLIC_`-prefixed so it cannot reach a browser by accident.
 *   2. **The redaction runs where it cannot be skipped.** `lib/report.ts`
 *      redacts before sending, and this route redacts again on arrival through
 *      the same `serializeReport`. That is not belt-and-braces for its own
 *      sake: this endpoint is public and unauthenticated, so a request body is
 *      whatever anybody chose to send. "The client already scrubbed it" is not
 *      something a server can check, and the report that reaches the webhook is
 *      the one this route built, never the one it was handed.
 *
 * ## The IP is used and never reported
 *
 * `clientIp` is read for the rate limit and goes no further. It is not a field
 * in `REPORT_FIELDS`, so it could not reach a report even if it were passed to
 * `serializeReport` — which is the allowlist doing the job it was chosen for,
 * on the one piece of identifying data this route unavoidably handles.
 */

import { clientIp, createRateLimit } from '@/lib/rate-limit';
import { serializeReport, type ErrorReport } from '@/lib/report';

/**
 * Tighter than the waitlist's five per ten minutes, because this endpoint is
 * called by code rather than by a person.
 *
 * The client caps itself at five reports per screen, so a browser behaving as
 * designed never comes close. This bounds a browser that is not — a render loop
 * firing on every frame, or somebody who has found the endpoint — and it bounds
 * it in front of a webhook that will happily deliver every one of them to a
 * channel a person is trying to read.
 *
 * Process-local, with the same honest accounting as everywhere else in this
 * repository: it raises the cost of a flood rather than bounding it, because
 * two instances keep two counters. See `lib/rate-limit.ts`.
 */
const limit = createRateLimit({ max: 20, windowMs: 5 * 60 * 1000 });

/**
 * A report is eight short strings. Anything an order of magnitude past that is
 * not a report, and reading it into memory before deciding so is the part worth
 * refusing.
 */
const MAX_BODY = 8_192;

/**
 * One body that both Discord and Slack accept.
 *
 * Discord reads `content` and ignores unknown keys; Slack reads `text` and
 * ignores unknown keys. Sending both means the sink is chosen by pasting a URL
 * into an environment variable rather than by editing this file, and neither
 * platform is named in the code.
 *
 * Plain text rather than an embed or a block kit attachment for the same
 * reason: the moment this formats a rich payload it has picked a platform.
 */
function webhookBody(report: ErrorReport): string {
  const lines = [
    `**${report.kind}** · ${report.path}`,
    report.message,
    [
      report.release !== undefined ? `build ${report.release}` : undefined,
      report.digest !== undefined ? `digest ${report.digest}` : undefined,
      report.at,
    ]
      .filter((part) => part !== undefined)
      .join(' · '),
    report.userAgent !== undefined ? report.userAgent : undefined,
    report.stack !== undefined ? '```\n' + report.stack + '\n```' : undefined,
  ].filter((line) => line !== undefined);

  const content = lines.join('\n');
  return JSON.stringify({ content, text: content });
}

export async function POST(request: Request): Promise<Response> {
  if (limit.check(clientIp(request))) {
    // No body. Nothing here is worth telling a caller that is over its budget.
    return new Response(null, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return new Response(null, { status: 400 });
  }

  // The only object that goes any further. Built here from the allowlist, out
  // of a body this route does not trust.
  const report = serializeReport(parsed as Record<string, unknown>);
  if (report === null) return new Response(null, { status: 400 });

  const webhook = process.env.LIMEN_ERROR_WEBHOOK;
  if (webhook === undefined || webhook.length === 0) {
    // Not a failure. A local `next dev`, a preview deploy and a Playwright run
    // all land here, and a log is where a developer already is — the pipeline
    // is exercised end to end either way, which is what makes the console
    // fallback worth having rather than a silent return.
    console.error(`limen report: ${JSON.stringify(report)}`);
    return new Response(null, { status: 204 });
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: webhookBody(report),
    });
  } catch (error) {
    // The report is lost and the browser is not told, because there is nothing
    // it could do about it. Note that this message names the failure and never
    // the report — the same discipline `api/waitlist/route.ts` applies to an
    // email address, for the same reason.
    console.error(
      `limen report: webhook delivery failed (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }

  // Always 204, delivered or not. A caller that could distinguish the two would
  // learn whether a webhook is configured, and a page that retried on failure
  // would turn one broken screen into a loop against someone else's endpoint.
  return new Response(null, { status: 204 });
}
