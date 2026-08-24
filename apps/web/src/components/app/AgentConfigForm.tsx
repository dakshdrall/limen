'use client';

import { StatusLabel } from '@/components/StatusLabel';
import {
  EXPIRY_OPTIONS,
  WINDOW_OPTIONS,
  type AgentConfigDraft,
  type FieldProblem,
} from '@/lib/agent-config';

/**
 * The configuration, as fields, split by who refuses.
 *
 * The split is the whole design of this component and it is not a visual
 * grouping. The two headings answer different questions:
 *
 *   **Enforced by the network.** A Stellar smart account holds a context rule
 *   carrying an OpenZeppelin `spending_limit` policy. Break one of these and
 *   the transaction fails on a ledger, with a hash and a contract error code.
 *   Limen is not in the path and could not permit it if it wanted to.
 *
 *   **Enforced by Limen.** Nothing on chain asserts these. `spending_limit`
 *   takes exactly two parameters — the limit and the period — and never sees a
 *   transfer's destination, so there is no audited policy that constrains where
 *   money goes or how much may leave in one call. Writing one means writing
 *   Rust, which this project does not do.
 *
 * ## The second group must never borrow the first one's clothes
 *
 * No hash column, no explorer link, no shared heading, and the reason stated in
 * the group rather than in a footnote a reader can skip. The label is
 * `COMPUTED LOCALLY`, which already means exactly this everywhere else in the
 * application. The precedent is `errors.ts` keeping `REVOKED_RULE_CODES` out of
 * `BOUNDARY_REFUSAL_CODES` so that *"the boundary refused you"* and *"the
 * boundary is gone"* cannot render identically — two kinds of refusal, kept
 * apart on purpose.
 *
 * The heading is rendered even though the second group has two members. A pair
 * of ungrouped fields under a grouped set reads as an afterthought rather than
 * as a different kind of thing.
 *
 * ## Why the asset contract has no default and no lookup
 *
 * Because the only way to produce one from the word *"USDC"* is to recall an
 * issuer address, and an address recalled rather than read is the class of
 * claim this repository refuses everywhere. A wrong one addresses a contract
 * that does not exist — or one that does. So it is a paste-in field, empty
 * until a person fills it, and the model is never asked for it.
 */
export function AgentConfigForm({
  draft,
  problems,
  onChange,
  disabled = false,
}: {
  draft: AgentConfigDraft;
  problems: readonly FieldProblem[];
  onChange: (next: AgentConfigDraft) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof AgentConfigDraft>(field: K, value: AgentConfigDraft[K]) => {
    onChange({ ...draft, [field]: value });
  };

  const messagesFor = (field: keyof AgentConfigDraft) =>
    problems.filter((problem) => problem.field === field).map((problem) => problem.message);

  return (
    <div className="flex flex-col gap-8">
      <Field
        label="Name"
        htmlFor="agent-name"
        messages={messagesFor('name')}
        hint="What this agent is called. It is a label on a row in Limen’s database and appears nowhere on chain."
      >
        <input
          id="agent-name"
          className="field"
          type="text"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => set('name', event.target.value)}
        />
      </Field>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
              Enforced by the network
            </h3>
            <StatusLabel name="ON-CHAIN" />
          </div>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            These become a context rule on the smart account. Exceed one and the transaction is
            refused on a ledger, with a hash and a contract error code. Limen is not in that path.
          </p>
        </div>

        <Field
          label="Token contract"
          htmlFor="agent-asset"
          messages={messagesFor('assetContractId')}
          hint="The token this agent may spend, as a contract address. Limen will not look this up from a name — paste the one you mean."
        >
          <input
            id="agent-asset"
            className="field"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="C…"
            value={draft.assetContractId}
            disabled={disabled}
            onChange={(event) => set('assetContractId', event.target.value.trim())}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="What you call it"
            htmlFor="agent-asset-label"
            messages={messagesFor('assetLabel')}
            hint="Display only. Nothing on chain reads this."
          >
            <input
              id="agent-asset-label"
              className="field"
              type="text"
              placeholder="USDC"
              value={draft.assetLabel}
              disabled={disabled}
              onChange={(event) => set('assetLabel', event.target.value)}
            />
          </Field>

          <Field
            label="Decimal places"
            htmlFor="agent-asset-decimals"
            messages={messagesFor('assetDecimals')}
            hint="Stellar Asset Contracts use 7. A custom token may not — check before you rely on the amounts below."
          >
            <input
              id="agent-asset-decimals"
              className="field"
              type="text"
              inputMode="numeric"
              value={draft.assetDecimals}
              disabled={disabled}
              onChange={(event) => set('assetDecimals', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Spend cap"
            htmlFor="agent-cap"
            messages={messagesFor('cap')}
            hint="The most this agent may spend in one window — with the window set to per day, this is its daily cap. The window resets on a rolling basis, and this is not a per-trade limit."
          >
            <input
              id="agent-cap"
              className="field"
              type="text"
              inputMode="decimal"
              placeholder="50"
              value={draft.cap}
              disabled={disabled}
              onChange={(event) => set('cap', event.target.value)}
            />
          </Field>

          <Field
            label="Window"
            htmlFor="agent-window"
            messages={messagesFor('windowId')}
            hint="How often the cap resets."
          >
            <select
              id="agent-window"
              className="field"
              value={draft.windowId}
              disabled={disabled}
              onChange={(event) => set('windowId', event.target.value)}
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Expires after"
          htmlFor="agent-expiry"
          messages={messagesFor('expiryId')}
          hint="The rule stops being valid at a fixed ledger. After that the agent’s key can do nothing, whether or not anyone remembered to revoke it."
        >
          <select
            id="agent-expiry"
            className="field"
            value={draft.expiryId}
            disabled={disabled}
            onChange={(event) => set('expiryId', event.target.value)}
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
              Enforced by Limen
            </h3>
            <StatusLabel name="COMPUTED LOCALLY" weight="loud" />
          </div>
          <p className="measure text-[12.5px] leading-relaxed text-muted">
            <strong className="font-semibold text-foreground">The ledger does not enforce these.</strong>{' '}
            No audited policy contract constrains where a token goes or the size of a single call —
            the spending limit sees an amount and a period and nothing else. Limen records what you
            put here and will refuse a trade that breaks it, and someone holding the agent&rsquo;s
            key could ignore Limen entirely and move funds to any address, up to your cap. Lower the
            cap if that matters more to you than convenience.
          </p>
        </div>

        <Field
          label="Per-trade cap"
          htmlFor="agent-per-transaction"
          messages={messagesFor('perTransactionCap')}
          hint="Optional. The most any single trade may spend. Leave it empty for no ceiling."
        >
          <input
            id="agent-per-transaction"
            className="field"
            type="text"
            inputMode="decimal"
            value={draft.perTransactionCap}
            disabled={disabled}
            onChange={(event) => set('perTransactionCap', event.target.value)}
          />
        </Field>

        <Field
          label="Allowed pair"
          htmlFor="agent-output-asset"
          messages={messagesFor('outputAssetContractId')}
          hint="Optional. The token this agent may buy, as a contract address. With the token above — the one it spends — this is the pair it may trade. Leave it empty for an agent that only pays."
        >
          <input
            id="agent-output-asset"
            className="field"
            type="text"
            spellCheck={false}
            placeholder="C…"
            value={draft.outputAssetContractId}
            disabled={disabled}
            onChange={(event) => set('outputAssetContractId', event.target.value)}
          />
        </Field>

        <Field
          label="Max position size"
          htmlFor="agent-max-position"
          messages={messagesFor('maxPositionSize')}
          hint="Optional. The most any single trade may spend. Different from the spend cap above, which governs a whole window — an agent under a daily cap can otherwise spend all of it in one trade. Leave it empty for no ceiling."
        >
          <input
            id="agent-max-position"
            className="field"
            type="text"
            inputMode="decimal"
            value={draft.maxPositionSize}
            disabled={disabled}
            onChange={(event) => set('maxPositionSize', event.target.value)}
          />
        </Field>

        <Field
          label="Allowed counterparties"
          htmlFor="agent-recipients"
          messages={messagesFor('recipients')}
          hint="One address per line — the venues or accounts this agent may send the token to. Leave it empty to approve none, which means Limen refuses every trade this agent proposes until you add one."
        >
          <textarea
            id="agent-recipients"
            className="field"
            rows={3}
            spellCheck={false}
            placeholder="G…"
            value={draft.recipients.join('\n')}
            disabled={disabled}
            onChange={(event) =>
              // Split on newlines and commas both: a pasted list arrives either
              // way, and turning a comma-separated paste into one malformed
              // address would produce a refusal that reads as a validation bug.
              set(
                'recipients',
                event.target.value.split(/[\n,]/).map((line) => line.trim()),
              )
            }
          />
        </Field>
      </section>
    </div>
  );
}

/**
 * One labelled input, its hint, and any refusal about it.
 *
 * The refusal renders against the field rather than in a list at the bottom,
 * because a message that names a field the reader then has to find is a message
 * they read twice. `role="alert"` so it is announced when it appears.
 */
function Field({
  label,
  htmlFor,
  hint,
  messages,
  children,
}: {
  label: string;
  htmlFor: string;
  hint: string;
  messages: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="col-head text-muted" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      <p className="measure text-[12px] leading-relaxed text-muted-dim">{hint}</p>
      {messages.map((message) => (
        <p key={message} role="alert" className="measure text-[12.5px] leading-relaxed text-deny">
          {message}
        </p>
      ))}
    </div>
  );
}
