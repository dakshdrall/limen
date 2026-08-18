/**
 * Where the expected origin comes from, and where it must not come from.
 */

import { describe, expect, it } from 'vitest';
import { resolveRelyingParty, expectationFor, RP_ID_ENV, ORIGINS_ENV } from '../src/lib/webauthn-config';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

describe('the relying party comes from configuration', () => {
  it('reads the id and the origin list', () => {
    const rp = resolveRelyingParty(
      env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: 'https://limen.app,https://www.limen.app' }),
    );
    expect(rp.rpId).toBe('limen.app');
    expect(rp.origins).toEqual(['https://limen.app', 'https://www.limen.app']);
  });

  it('tolerates whitespace and empty entries in the list', () => {
    // A trailing comma in an environment variable is not a configuration error
    // worth refusing a deployment over.
    const rp = resolveRelyingParty(env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: ' https://limen.app , ,' }));
    expect(rp.origins).toEqual(['https://limen.app']);
  });

  it('adds the preview hostname the platform supplies', () => {
    const rp = resolveRelyingParty(
      env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: 'https://limen.app', VERCEL_URL: 'limen-git-m1.vercel.app' }),
    );
    expect(rp.origins).toContain('https://limen-git-m1.vercel.app');
  });

  it('does not add the preview hostname twice', () => {
    const rp = resolveRelyingParty(
      env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: 'https://x.vercel.app', VERCEL_URL: 'x.vercel.app' }),
    );
    expect(rp.origins.filter((o) => o === 'https://x.vercel.app')).toHaveLength(1);
  });
});

describe('the production refusal', () => {
  it('refuses on the production deployment when nothing is configured', () => {
    // A deployment that defaulted to the request's host would accept every
    // login and look like it was working, which is worse than no check.
    expect(() => resolveRelyingParty(env({ VERCEL_ENV: 'production' }))).toThrow(RP_ID_ENV);
  });

  it('refuses on a self-hosted production build too', () => {
    expect(() => resolveRelyingParty(env({ NODE_ENV: 'production' }))).toThrow(ORIGINS_ENV);
  });

  it('treats a Vercel preview as not-production, because NODE_ENV cannot tell', () => {
    // Vercel sets NODE_ENV=production for preview builds. Keying the refusal
    // off it would break every preview login.
    const rp = resolveRelyingParty(env({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }));
    expect(rp.rpId).toBe('localhost');
  });

  it('says why it refused, in terms of what actually goes wrong', () => {
    let message = '';
    try {
      resolveRelyingParty(env({ VERCEL_ENV: 'production' }));
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    // The refusal has to be actionable, or it gets worked around with the
    // header-derived default it exists to prevent.
    expect(message).toContain('supplied by the');
    expect(message).toContain('webauthn-config.ts');
  });

  it('falls back to localhost in development, so the ceremony still runs', () => {
    const rp = resolveRelyingParty(env({}));
    expect(rp.rpId).toBe('localhost');
    expect(rp.origins).toEqual(['http://localhost:3000']);
  });
});

describe('the expectation handed to the verifier', () => {
  it('asks for webauthn.create when registering and webauthn.get when logging in', () => {
    // The server-side half of the ceremony-confusion check: even if a browser
    // lies about `type`, a challenge minted for one purpose cannot be spent in
    // the other.
    const config = env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: 'https://limen.app' });
    expect(expectationFor('register', 'c', config).type).toBe('webauthn.create');
    expect(expectationFor('login', 'c', config).type).toBe('webauthn.get');
  });

  it('carries the challenge it was given', () => {
    const config = env({ [RP_ID_ENV]: 'limen.app', [ORIGINS_ENV]: 'https://limen.app' });
    expect(expectationFor('login', 'the-challenge', config).challenge).toBe('the-challenge');
  });
});
