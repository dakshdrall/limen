import { ImageResponse } from 'next/og';
import { GROUND, TEXT, VERDICT } from '@/lib/theme';

/**
 * The share card.
 *
 * Same palette and same restraint as the page: the ground, the wordmark, one
 * line of description, and the four-step contrast ramp. No gradient, no
 * illustration, no screenshot — a link to a security tool should look like the
 * tool.
 *
 * `ImageResponse` renders through satori, which supports flexbox and a subset
 * of CSS only; `display: grid` and most shorthand properties do not apply here.
 * Custom properties do not resolve either: there is no stylesheet and no
 * cascade, only inline styles.
 *
 * That is why the colours were literals, and why "same palette as the page" had
 * quietly stopped being true — all eleven had drifted from the tokens they were
 * copied from, by one or two steps each. `lib/theme.ts` is the fix and carries
 * the full list of what they had become. This file now holds no colour of its
 * own, and `design-system.test.ts` asserts it never will again.
 *
 * The text is ASCII throughout. Satori resolves glyphs against a font it
 * fetches at build time, and anything outside the default subset — the ✓ and ✕
 * the page itself uses — silently renders as a blank box on a machine that
 * cannot reach the font service. PERMIT and DENY are legible without them.
 */
export const alt = 'Limen — the permission layer for agentic money on Stellar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: GROUND.background,
          padding: '84px 88px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 21,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: TEXT.mutedDim,
          }}
        >
          smart-account policy synthesis · stellar · soroban
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 108,
              fontWeight: 700,
              letterSpacing: 24,
              color: TEXT.foreground,
            }}
          >
            LIMEN
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              maxWidth: 880,
              fontSize: 36,
              lineHeight: 1.35,
              color: TEXT.muted,
            }}
          >
            A boundary an agent can spend inside, derived from a transaction that already happened.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 22 }}>
          <div
            style={{
              display: 'flex',
              padding: '8px 18px',
              border: `1px solid ${VERDICT.permitLine}`,
              backgroundColor: VERDICT.permitDim,
              borderRadius: 4,
              color: VERDICT.permit,
              fontWeight: 700,
              letterSpacing: 3,
            }}
          >
            PERMIT
          </div>
          <div
            style={{
              display: 'flex',
              padding: '8px 18px',
              border: `1px solid ${VERDICT.denyLine}`,
              backgroundColor: VERDICT.denyDim,
              borderRadius: 4,
              color: VERDICT.deny,
              fontWeight: 700,
              letterSpacing: 3,
            }}
          >
            DENY
          </div>
          <div style={{ display: 'flex', marginLeft: 8, color: TEXT.faint }}>
            the observed flow, and nothing adjacent to it
          </div>
        </div>
      </div>
    ),
    size,
  );
}
