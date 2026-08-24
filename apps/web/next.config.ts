import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The build an error report came from, inlined at build time.
   *
   * Truncated to seven characters here rather than in `lib/report.ts`, and the
   * reason is the redactor: a full commit SHA is 40 hex characters, `redact()`
   * removes any hex run of 32 or more, and a release field that arrived at full
   * length would be destroyed by the very function that makes it safe to send.
   * Seven is also the form `git show` takes, so the value in the report is the
   * value somebody pastes into a terminal.
   *
   * Vercel supplies `VERCEL_GIT_COMMIT_SHA` on every deployment. Absent — a
   * local build, a fork, a runner — the field is simply not in the report;
   * `serializeReport` drops empty strings, so nothing renders `build unknown`.
   */
  env: {
    NEXT_PUBLIC_LIMEN_RELEASE: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  },

  /**
   * Origins allowed to request dev-only assets, so a probe can be clicked.
   *
   * Next blocks cross-origin requests to dev resources — `/__nextjs_font/*`,
   * HMR, the error overlay — from any host other than the one the server was
   * started on. That default is right, and it is not a production control:
   * `allowedDevOrigins` is read only by `next dev` and has no effect on a
   * build, so nothing here widens what the deployed app accepts.
   *
   * It is listed because this repository is developed in a Codespace, where the
   * browser reaches the server through a forwarded `*.app.github.dev` host
   * while the server believes it is `localhost`. Every request is therefore
   * cross-origin, and the visible symptom is a page that renders but whose
   * fonts and overlay are blocked — which is a confusing thing to hand somebody
   * who is about to run a measurement and needs to trust what they see.
   *
   * `127.0.0.1` is here alongside `localhost` because they are different
   * origins to this check, and the VS Code port forwarder uses the numeric one.
   */
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.app.github.dev'],

  /**
   * `/demo` moved to `/app/simulator` when the demo stopped being the product
   * and became one instrument among several.
   *
   * A permanent redirect rather than a deleted route: the old path is in this
   * repository's README history, in PLAN-V2, and in whatever a reviewer
   * bookmarked while the demo was the front door. 308 preserves the request
   * method, though nothing ever POSTed here.
   */
  redirects() {
    return Promise.resolve([{ source: '/demo', destination: '/app/simulator', permanent: true }]);
  },
};

export default nextConfig;
