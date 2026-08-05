/**
 * The two roles, and the sentence that has to appear wherever a key is made.
 *
 * A dependency-free module, for the same reason `markers.ts` is one: a client
 * component that needs to *name* a role or state the disposability rule must
 * not have to reach through `local-key.ts` into the Stellar SDK to do it. The
 * badge beside a signature is a label and a string; it should not cost a
 * signing library.
 */

/**
 * Which key is acting. Rendered beside every signature, every time.
 *
 * Not a display detail. The demonstration is that the agent's key cannot exceed
 * a boundary the owner's key installed, and a person who cannot see which of
 * the two is about to sign cannot check that claim. Steps 7, 8 and 10 of the
 * acceptance flow carry `AGENT`; nothing else does.
 */
export type KeyRole = 'OWNER' | 'AGENT';

export const KEY_ROLES: readonly KeyRole[] = ['OWNER', 'AGENT'];

/**
 * There is no code path from a stored key to a string a user can read.
 *
 * Exported as a constant so it is one sentence rather than a paraphrase per
 * screen, and so a reviewer grepping this module for a backup flow finds this
 * instead of one. See `local-key.ts` for why offering an export would be worse
 * than the thing it would protect against.
 */
export const NOT_EXPORTABLE =
  'This key cannot be exported. Clearing site data destroys it, and with it the account it owns.';
