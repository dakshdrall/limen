import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
