import { ImageResponse } from 'next/og';

/**
 * The share card.
 *
 * Same palette and same restraint as the page: the fixed dark background, the
 * wordmark, one line of description, and the four-step contrast ramp. No
 * gradient, no illustration, no screenshot — a link to a security tool should
 * look like the tool.
 *
 * `ImageResponse` renders through satori, which supports flexbox and a subset
 * of CSS only; `display: grid` and most shorthand properties do not apply
 * here. Colours are literals rather than custom properties for the same
 * reason.
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
          backgroundColor: '#0a0b0d',
          padding: '84px 88px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 21,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#6c747e',
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
              color: '#e7eaee',
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
              color: '#9aa2ac',
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
              border: '1px solid #1f5c2c',
              backgroundColor: '#0d2413',
              borderRadius: 4,
              color: '#4ac95e',
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
              border: '1px solid #7a2b27',
              backgroundColor: '#2a0f0f',
              borderRadius: 4,
              color: '#ff6b62',
              fontWeight: 700,
              letterSpacing: 3,
            }}
          >
            DENY
          </div>
          <div style={{ display: 'flex', marginLeft: 8, color: '#464d56' }}>
            the observed flow, and nothing adjacent to it
          </div>
        </div>
      </div>
    ),
    size,
  );
}
