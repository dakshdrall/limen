-- One accepted request, and the only thing a caller has to poll.
--
-- §7.5.4 accepts fast and works asynchronously: a request is verified,
-- enqueued and acknowledged, and the worker runs the turn. What the caller
-- waits on therefore has to be a row — the web chat and the Telegram bot both
-- ask "is it done, and what happened", and answering that from process memory
-- would lose every in-flight turn on a deploy.
--
-- `status` (queued/running/done) and `outcome` (§4.4's five) are separate
-- columns because they are separate facts: a turn that ended in a refusal is
-- done, not failed.

CREATE TYPE "public"."turn_status" AS ENUM('queued', 'running', 'done');--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"channel" "channel" NOT NULL,
	"status" "turn_status" DEFAULT 'queued' NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb,
	"outcome" "tool_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turns_agent_id_idx" ON "turns" USING btree ("agent_id","created_at");
--> statement-breakpoint
-- The grant this table needs, in the migration that creates it.
--
-- `0001` deliberately made no `ALTER DEFAULT PRIVILEGES`: a blanket default
-- would silently grant UPDATE and DELETE on every table added afterwards,
-- including a second audit table. So each new table names its own grant, and
-- this is the first one to owe it.
--
-- UPDATE is included and is load-bearing rather than habitual: the worker
-- claims a turn with `UPDATE ... WHERE status = 'queued'`, which is what makes
-- a duplicate delivery do nothing. DELETE is granted with the rest of the
-- application's tables — this is not an audit trail, and `audit_events`
-- remains the only table the application cannot rewrite.
GRANT SELECT, INSERT, UPDATE, DELETE ON turns TO limen_app;
