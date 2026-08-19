/**
 * One error type for the whole WebAuthn path, in a module with no dependencies.
 *
 * It lives here rather than in `webauthn.ts` for a reason that is about testing
 * rather than about tidiness. `webauthn.ts` and `webauthn-config.ts` both carry
 * `import 'server-only'`, which throws outside the `react-server` condition —
 * that is the marker doing its job, and both modules earn it: one reaches
 * `node:crypto`, the other reads the environment.
 *
 * `attestation.ts` earns neither. It is bytes in, bytes out, with no secret, no
 * environment read and no I/O, and it is imported directly by
 * `e2e/passkey-registration.spec.ts` so that the parser under test is the module
 * that ships rather than a copy of it. That import is only possible if nothing
 * on its path is marked server-only, which is what this file exists to make
 * true.
 *
 * The alternative — a second error class for the parser — was rejected because
 * a route would then have two shapes to catch, and the first `catch` written
 * against one of them would silently turn the other into a 500.
 */

export class WebAuthnError extends Error {
  /**
   * A stable, machine-readable code.
   *
   * Separate from `message` because `message` is written for whoever is reading
   * a log and `reason` is what a test asserts on. A test that matched on prose
   * would go red the first time somebody improved a sentence, and the usual
   * repair for that is to stop asserting the reason at all.
   */
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'WebAuthnError';
    this.reason = reason;
  }
}
