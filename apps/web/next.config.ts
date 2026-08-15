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
