/**
 * @limen/core — the deterministic half of Limen.
 *
 * Dependency-free, no network IO, no browser globals, no Next.js. This package
 * is the unit a future MCP server imports directly.
 *
 * TODO(roadmap): the MCP server attaches here. Keep this package free of
 * anything that assumes a browser or a Next.js request lifecycle.
 */

export * from './types.js';
export { synthesize } from './synthesize.js';
export { evaluate } from './evaluate.js';
export { generateDenyCases } from './denycases.js';
