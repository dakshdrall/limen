-- The venue rule, for agents that trade.
--
-- A trading agent's authority is two context rules. The one already recorded in
-- `context_rule_id` is on the token and carries the spending limit; this one is
-- on the swap venue and carries no policy at all. Both ids are needed to build
-- a swap's `AuthPayload`, which takes one context rule id per auth context, so
-- recording only the first makes a swap unsignable.
--
-- Recorded rather than discovered, for the reason `gate.ts` gives about looking
-- a rule up by its saved id: a rule found by scanning for one that "looks right"
-- would let a revoked rule be silently replaced by a different one. Absence has
-- to stay readable as absence.
--
-- Nullable, and the null means something. An agent deployed before trading, or
-- one deployed as a payment agent, has no venue rule and cannot swap —
-- `swap_tokens` refuses on exactly that, rather than guessing an id.
ALTER TABLE "agent_accounts" ADD COLUMN "venue_context_rule_id" integer;
ALTER TABLE "agent_accounts" ADD COLUMN "venue_install_tx_hash" text;
