/**
 * The entrypoint, separate from `index.ts` on purpose.
 *
 * `index.ts` is the module a test or another package imports; importing it must
 * not start a process. This file is the one the container runs, and it is the
 * only place `main()` is called. The alternative — a top-level call guarded by
 * an `import.meta.main` check — is the shape that makes a test suite mysteriously
 * open a Redis connection.
 */

import { main } from './index.js';

main().catch((error: unknown) => {
  console.error(`limen runtime: failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
