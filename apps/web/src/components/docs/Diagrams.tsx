/**
 * The diagrams, drawn from the design tokens.
 *
 * Inline SVG with `var(--…)` for every fill and stroke, so a diagram is the
 * same ink as the page around it and cannot drift from the palette the way an
 * exported image always eventually does. There are no colour literals in this
 * file, for the same reason there are none in `Mark.tsx` — and unlike a
 * screenshot, these stay correct when a token changes.
 *
 * No stock imagery, no abstract renders, nothing generated. Each of these draws
 * a mechanism this repository actually implements, and the labels are the real
 * function names: `extract`, `synthesize`, `lower`, `__check_auth`.
 *
 * ## Why they are `<svg>` and not `<img>`
 *
 * Three properties an image cannot have: text that is selectable and
 * searchable, an accessible name and description that a screen reader can
 * actually read, and stroke widths that stay hairlines at any zoom. A diagram
 * of an authorization path whose labels cannot be copied is a diagram a reader
 * has to retype into their editor.
 *
 * Sized with `viewBox` plus `width: 100%`, so they scale to the column without
 * a media query and without ever forcing the page wider — the diagrams are
 * inside `.screen`'s content column, and a fixed-width SVG there is one of the
 * ways a page starts scrolling sideways at 390.
 */

/** Shared type scale for diagram labels, in user units. */
const LABEL = 11;
const SMALL = 9.5;

function Box({
  x,
  y,
  w,
  h,
  tone = 'default',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: 'default' | 'accent' | 'deny' | 'permit' | 'sunken';
}) {
  const fill =
    tone === 'accent'
      ? 'var(--accent-dim)'
      : tone === 'deny'
        ? 'var(--deny-dim)'
        : tone === 'permit'
          ? 'var(--permit-dim)'
          : tone === 'sunken'
            ? 'var(--surface-sunken)'
            : 'var(--surface)';
  const stroke =
    tone === 'accent'
      ? 'var(--accent)'
      : tone === 'deny'
        ? 'var(--deny-line)'
        : tone === 'permit'
          ? 'var(--permit-line)'
          : 'var(--border)';
  return <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={1} />;
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <g stroke="var(--border-bright)" strokeWidth={1} fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polyline
        points={
          y1 === y2
            ? `${x2 - 5},${y2 - 3.5} ${x2},${y2} ${x2 - 5},${y2 + 3.5}`
            : `${x2 - 3.5},${y2 - 5} ${x2},${y2} ${x2 + 3.5},${y2 - 5}`
        }
        stroke="var(--border-bright)"
      />
    </g>
  );
}

function Label({
  x,
  y,
  children,
  anchor = 'middle',
  tone = 'foreground',
  size = LABEL,
  mono = true,
}: {
  x: number;
  y: number;
  children: string;
  anchor?: 'start' | 'middle' | 'end';
  tone?: 'foreground' | 'muted' | 'dim' | 'accent' | 'deny' | 'permit';
  size?: number;
  mono?: boolean;
}) {
  const fill = {
    foreground: 'var(--foreground)',
    muted: 'var(--muted)',
    dim: 'var(--muted-dim)',
    accent: 'var(--accent)',
    deny: 'var(--deny)',
    permit: 'var(--permit)',
  }[tone];
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={fill}
      fontSize={size}
      fontFamily={mono ? 'var(--font-mono)' : 'var(--font-sans)'}
    >
      {children}
    </text>
  );
}

/**
 * One observed transaction becoming an installed boundary.
 *
 * The four functions are the real pipeline: `extract` turns a Soroban
 * transaction into an `ObservedTransaction`, `synthesize` derives the narrowest
 * proposal that permits it, `lower` turns that proposal into the exact contract
 * arguments, and the install is one signed call.
 */
export function DerivationDiagram() {
  return (
    <svg
      viewBox="0 0 720 190"
      width="100%"
      role="img"
      aria-labelledby="derivation-title derivation-desc"
      className="max-w-full"
    >
      <title id="derivation-title">How a boundary is derived</title>
      <desc id="derivation-desc">
        A transaction observed on chain is passed through extract, then synthesize, then lower,
        producing a context rule and policy set that is installed on the smart account in one
        signed call. The derived cap equals the observed outflow.
      </desc>

      <Label x={0} y={14} anchor="start" tone="dim" size={SMALL}>
        OBSERVED
      </Label>
      <Box x={0} y={24} w={132} h={52} tone="sunken" />
      <Label x={66} y={45} size={LABEL}>
        transaction
      </Label>
      <Label x={66} y={62} tone="dim" size={SMALL}>
        on a ledger
      </Label>

      <Arrow x1={132} y1={50} x2={168} y2={50} />

      <Box x={168} y={24} w={120} h={52} />
      <Label x={228} y={45}>
        extract()
      </Label>
      <Label x={228} y={62} tone="dim" size={SMALL}>
        contracts, fns
      </Label>

      <Arrow x1={288} y1={50} x2={324} y2={50} />

      <Box x={324} y={24} w={120} h={52} />
      <Label x={384} y={45}>
        synthesize()
      </Label>
      <Label x={384} y={62} tone="dim" size={SMALL}>
        narrowest rule
      </Label>

      <Arrow x1={444} y1={50} x2={480} y2={50} />

      <Box x={480} y={24} w={120} h={52} />
      <Label x={540} y={45}>
        lower()
      </Label>
      <Label x={540} y={62} tone="dim" size={SMALL}>
        contract args
      </Label>

      <Arrow x1={600} y1={50} x2={636} y2={50} />

      <Box x={636} y={24} w={84} h={52} tone="accent" />
      <Label x={678} y={45} tone="accent">
        install
      </Label>
      <Label x={678} y={62} tone="dim" size={SMALL}>
        1 call
      </Label>

      {/* The equality that is the whole claim, drawn as a tie-line between the
          observed outflow and the derived cap rather than stated in a caption. */}
      <line
        x1={66}
        y1={92}
        x2={66}
        y2={120}
        stroke="var(--permit-line)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <line
        x1={384}
        y1={92}
        x2={384}
        y2={120}
        stroke="var(--permit-line)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <line x1={66} y1={120} x2={384} y2={120} stroke="var(--permit-line)" strokeWidth={1} />
      <Label x={225} y={140} tone="permit" size={SMALL}>
        derived cap = observed outflow, exactly
      </Label>
      <Label x={225} y={158} tone="dim" size={SMALL} mono={false}>
        not a round number near it
      </Label>
    </svg>
  );
}

/**
 * What the network runs before a token moves.
 *
 * The important thing this draws is *where* the refusal comes from. Nothing in
 * this path is Limen: the account contract and the policy contract are both
 * deployed OpenZeppelin code, and the check happens whether or not this
 * repository still exists.
 */
export function AuthorizationDiagram() {
  return (
    <svg
      viewBox="0 0 720 336"
      width="100%"
      role="img"
      aria-labelledby="auth-title auth-desc"
      className="max-w-full"
    >
      <title id="auth-title">The authorization path</title>
      <desc id="auth-desc">
        The agent signs an envelope. The network invokes __check_auth on the smart account, which
        finds the context rule for that signer, verifies the signature through the ed25519 verifier,
        and asks each attached policy. If every policy assents the transfer executes; if any refuses
        the invocation traps and nothing moves.
      </desc>

      <Box x={0} y={0} w={200} h={46} tone="sunken" />
      <Label x={100} y={22}>
        agent signs
      </Label>
      <Label x={100} y={37} tone="dim" size={SMALL}>
        its own key, its own fee
      </Label>

      <Arrow x1={100} y1={46} x2={100} y2={76} />

      <Box x={0} y={76} w={200} h={46} />
      <Label x={100} y={98}>
        network
      </Label>
      <Label x={100} y={113} tone="dim" size={SMALL}>
        invokes __check_auth
      </Label>

      <Arrow x1={200} y1={99} x2={244} y2={99} />

      {/* The account's own code. Everything inside this frame is contract code
          on the ledger, not application code. */}
      <rect
        x={244}
        y={12}
        width={476}
        height={220}
        rx={4}
        fill="var(--surface-sunken)"
        stroke="var(--border-bright)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <Label x={256} y={30} anchor="start" tone="dim" size={SMALL}>
        SMART ACCOUNT CONTRACT — ON LEDGER, NOT THIS APPLICATION
      </Label>

      <Box x={264} y={44} w={196} h={46} />
      <Label x={362} y={65}>
        find context rule
      </Label>
      <Label x={362} y={80} tone="dim" size={SMALL}>
        for this signer
      </Label>

      <Arrow x1={460} y1={67} x2={496} y2={67} />

      <Box x={496} y={44} w={200} h={46} />
      <Label x={596} y={65}>
        verify signature
      </Label>
      <Label x={596} y={80} tone="dim" size={SMALL}>
        ed25519 verifier contract
      </Label>

      <Arrow x1={362} y1={90} x2={362} y2={120} />

      <Box x={264} y={120} w={432} h={46} />
      <Label x={480} y={141}>
        each attached policy asserts
      </Label>
      <Label x={480} y={156} tone="dim" size={SMALL}>
        spending limit · function allowlist
      </Label>

      <Arrow x1={362} y1={166} x2={362} y2={196} />
      <Arrow x1={596} y1={166} x2={596} y2={196} />

      <Box x={264} y={196} w={196} h={24} tone="permit" />
      <Label x={362} y={212} tone="permit" size={SMALL}>
        ✓ every policy assents
      </Label>

      <Box x={496} y={196} w={200} h={24} tone="deny" />
      <Label x={596} y={212} tone="deny" size={SMALL}>
        ✕ any policy refuses → trap
      </Label>

      <Arrow x1={362} y1={232} x2={362} y2={262} />

      <Box x={264} y={262} w={196} h={44} tone="permit" />
      <Label x={362} y={283} tone="permit">
        transfer executes
      </Label>
      <Label x={362} y={298} tone="dim" size={SMALL}>
        the token moves
      </Label>

      <Box x={496} y={262} w={200} h={44} tone="deny" />
      <Label x={596} y={283} tone="deny">
        nothing moves
      </Label>
      <Label x={596} y={298} tone="dim" size={SMALL}>
        fee burned, hash on ledger
      </Label>
    </svg>
  );
}

/**
 * What is actually installed on the account.
 *
 * Drawn because the relationship between signers, context rules and policies is
 * the single thing people get wrong when reading the OpenZeppelin interface for
 * the first time — a policy is attached to a *rule*, not to a signer, and a
 * signer's authority is exactly the union of the rules naming it.
 */
export function AccountStructureDiagram() {
  return (
    <svg
      viewBox="0 0 720 250"
      width="100%"
      role="img"
      aria-labelledby="struct-title struct-desc"
      className="max-w-full"
    >
      <title id="struct-title">The structure of a smart account</title>
      <desc id="struct-desc">
        A smart account holds context rules. The owner holds a Default rule that authorizes any
        call. The agent is registered under a CallContract rule scoped to one token contract, with a
        spending limit policy attached to that rule. A policy is attached to a rule, not to a signer.
      </desc>

      <rect
        x={0}
        y={0}
        width={720}
        height={250}
        rx={4}
        fill="var(--surface-sunken)"
        stroke="var(--border-bright)"
        strokeWidth={1}
      />
      <Label x={16} y={22} anchor="start" tone="dim" size={SMALL}>
        SMART ACCOUNT
      </Label>

      {/* Owner */}
      <Box x={16} y={38} w={330} h={90} />
      <Label x={30} y={58} anchor="start" tone="dim" size={SMALL}>
        CONTEXT RULE — DEFAULT
      </Label>
      <Label x={30} y={80} anchor="start">
        owner signer
      </Label>
      <Label x={30} y={98} anchor="start" tone="muted" size={SMALL} mono={false}>
        Authorizes any call the account can make.
      </Label>
      <Label x={30} y={114} anchor="start" tone="muted" size={SMALL} mono={false}>
        No policy attached — this is the rule revoke needs.
      </Label>

      {/* Agent */}
      <Box x={374} y={38} w={330} h={90} tone="accent" />
      <Label x={388} y={58} anchor="start" tone="dim" size={SMALL}>
        CONTEXT RULE — CALLCONTRACT
      </Label>
      <Label x={388} y={80} anchor="start">
        agent signer
      </Label>
      <Label x={388} y={98} anchor="start" tone="muted" size={SMALL} mono={false}>
        Scoped to one token contract, derived from
      </Label>
      <Label x={388} y={114} anchor="start" tone="muted" size={SMALL} mono={false}>
        the observed transaction. Nothing wider.
      </Label>

      <Arrow x1={539} y1={128} x2={539} y2={158} />

      <Box x={374} y={158} w={330} h={72} tone="sunken" />
      <Label x={388} y={178} anchor="start" tone="dim" size={SMALL}>
        POLICY ATTACHED TO THE RULE
      </Label>
      <Label x={388} y={198} anchor="start">
        spending_limit
      </Label>
      <Label x={388} y={216} anchor="start" tone="muted" size={SMALL} mono={false}>
        A configured OpenZeppelin primitive. Cap plus window.
      </Label>

      <Label x={16} y={178} anchor="start" tone="muted" size={SMALL} mono={false}>
        A policy is attached to a rule, not to a signer.
      </Label>
      <Label x={16} y={196} anchor="start" tone="muted" size={SMALL} mono={false}>
        A signer&rsquo;s authority is the union of the rules
      </Label>
      <Label x={16} y={212} anchor="start" tone="muted" size={SMALL} mono={false}>
        that name it — which is why removing the agent&rsquo;s
      </Label>
      <Label x={16} y={228} anchor="start" tone="muted" size={SMALL} mono={false}>
        rule removes its authority entirely.
      </Label>
    </svg>
  );
}
