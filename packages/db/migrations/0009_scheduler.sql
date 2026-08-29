-- The scheduler: what makes an agent act without a person pressing anything.
--
-- An agent has known its trigger since 0008 and still waited for a button. This
-- is the row that says *when to ask it*, and the columns that make asking twice
-- impossible and a broken schedule visible.
--
-- ## An interval, and `cron` becomes nullable rather than being used
--
-- `cron` has been here since 0000 for the brief's *"pay my contractor 20 USDC
-- every Friday"*, and that is a payment agent's shape. A trading agent wants
-- "every fifteen minutes", which is an interval — and reading a cron expression
-- means a parser, a timezone and a DST rule, all of which can be wrong in ways
-- that are invisible until the clocks change. So `interval_seconds` arrives, and
-- the CHECK requires exactly one of the two: a row cannot say both, and cannot
-- say neither. `cron` stays for the milestone that wants it.
--
-- ## `next_run_at` is the claim, not a hint
--
-- The scheduler advances this column with a conditional UPDATE — `WHERE id = $1
-- AND next_run_at <= now() AND enabled` — and only the caller whose UPDATE
-- matched a row enqueues anything. That is the same single-winner discipline
-- `turns.started_at` records for the worker's claim, applied one layer up: two
-- ticks, or two processes, or a redelivery, and exactly one of them owns a due
-- window.
--
-- It advances to the next *future* slot, never to the slot after the one that
-- was missed. A scheduler that caught up would re-run turns for windows it was
-- down through, and a turn that may have submitted must never be re-run — see
-- `turns.started_at`. An agent misses slots when the scheduler is down, and
-- that is the honest failure of the two.
--
-- ## The breaker, and why it is not a status on the agent
--
-- `consecutive_failures` counts cycles that ended as something other than
-- succeeded and other than a no-trade. A no-trade cycle costs three RPC reads
-- and no fee and is the ordinary quiet case, so it does not count. A refused
-- swap does: an over-cap refusal reaches a ledger, which means it pays a fee
-- every time it is retried, and the burn lands on the fee account rather than
-- on the capped balance.
--
-- At three, `enabled` goes false and `disabled_at` and `disabled_reason` record
-- why. The agent's own status is deliberately untouched: it is still deployed,
-- its boundary is still installed, and it can still be run by hand. Writing
-- `ERROR` onto the agent would say something false about all three. The screens
-- read these two columns so a stopped schedule cannot look like a healthy one.
ALTER TABLE "scheduled_tasks" ALTER COLUMN "cron" DROP NOT NULL;
ALTER TABLE "scheduled_tasks" ADD COLUMN "interval_seconds" integer;
ALTER TABLE "scheduled_tasks" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;
ALTER TABLE "scheduled_tasks" ADD COLUMN "disabled_at" timestamp with time zone;
ALTER TABLE "scheduled_tasks" ADD COLUMN "disabled_reason" text;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_cron_xor_interval" CHECK (
  ("cron" IS NOT NULL) <> ("interval_seconds" IS NOT NULL)
);

--> statement-breakpoint

-- The slot a turn belongs to, and the constraint that makes one turn per slot a
-- property rather than a hope.
--
-- The conditional UPDATE above is the mechanism and this is the fence behind it.
-- If that statement is ever weakened — a caller that reads then writes, a second
-- scheduler, a well-meant retry — this index still refuses the second turn for a
-- window, and a scheduled trade that runs twice is two trades that cannot be
-- undone. Both refusals, for the reason the trigger's ratchet has two.
--
-- Partial, because every turn a person starts by hand has neither column set and
-- must not collide with anything.
ALTER TABLE "turns" ADD COLUMN "scheduled_task_id" uuid;
ALTER TABLE "turns" ADD COLUMN "due_at" timestamp with time zone;
ALTER TABLE "turns" ADD CONSTRAINT "turns_scheduled_task_id_fk"
  FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "turns_scheduled_slot_key" ON "turns" ("scheduled_task_id", "due_at")
  WHERE "scheduled_task_id" IS NOT NULL;
