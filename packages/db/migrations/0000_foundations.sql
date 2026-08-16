CREATE TYPE "public"."agent_status" AS ENUM('DRAFT', 'CONFIGURED', 'DEPLOYING', 'ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."audit_actor" AS ENUM('user', 'agent', 'system', 'operator');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('passkey', 'browser_key');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('telegram', 'web', 'api');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."network" AS ENUM('testnet');--> statement-breakpoint
CREATE TYPE "public"."owner_signer_kind" AS ENUM('passkey', 'ed25519');--> statement-breakpoint
CREATE TYPE "public"."policy_decision" AS ENUM('permit', 'refuse', 'confirm_required');--> statement-breakpoint
CREATE TYPE "public"."policy_source" AS ENUM('demonstrated', 'described');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('proposed', 'installed', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('conservative', 'balanced', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."tool_outcome" AS ENUM('agent_error', 'refused_by_limen', 'refused_by_network', 'infra_error', 'succeeded');--> statement-breakpoint
CREATE TABLE "agent_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"smart_account_contract_id" text NOT NULL,
	"deploy_tx_hash" text,
	"owner_signer_kind" "owner_signer_kind" NOT NULL,
	"owner_public_key" text NOT NULL,
	"agent_public_key" text NOT NULL,
	"agent_fee_account" text,
	"context_rule_id" integer,
	"install_tx_hash" text,
	"fee_balance_last_seen" numeric(39, 0),
	"fee_balance_ledger" integer
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"kms_key_id" text NOT NULL,
	"algorithm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "agent_status" DEFAULT 'DRAFT' NOT NULL,
	"network" "network" DEFAULT 'testnet' NOT NULL,
	"model_provider" text,
	"model_id" text,
	"system_instructions" text,
	"risk_level" "risk_level" DEFAULT 'conservative' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deployed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" "audit_actor" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"result" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"response_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text,
	"tool_calls_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" "policy_source" NOT NULL,
	"observed_tx_hash" text,
	"observed_ledger" integer,
	"headroom_bps" integer,
	"window_ledgers" integer,
	"valid_until_ledger" integer,
	"proposal_json" jsonb,
	"install_plan_json" jsonb,
	"enforced_offchain_json" jsonb,
	"install_tx_hash" text,
	"context_rule_id" integer,
	"status" "policy_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"cron" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paired_via_token_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"tool_name" text NOT NULL,
	"arguments_json" jsonb,
	"policy_decision" "policy_decision",
	"policy_reason" text,
	"decision_token_id" uuid,
	"outcome" "tool_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool_execution_id" uuid,
	"hash" text,
	"reached_ledger" boolean DEFAULT false NOT NULL,
	"ledger" integer,
	"amount" numeric(39, 0),
	"asset" text,
	"destination" text,
	"op_result_name" text,
	"contract_error_codes" integer[],
	"is_boundary_refusal" boolean,
	"is_revoked_rule" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auth_method" "auth_method" NOT NULL,
	"passkey_credential_id" "bytea",
	"passkey_public_key" "bytea",
	"display_name" text
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tool_execution_id_tool_executions_id_fk" FOREIGN KEY ("tool_execution_id") REFERENCES "public"."tool_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_accounts_agent_id_key" ON "agent_accounts" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_agent_id_key" ON "agent_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agents_user_id_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor","actor_id");--> statement-breakpoint
CREATE INDEX "conversations_agent_id_idx" ON "conversations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_agent_id_idx" ON "idempotency_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "policies_agent_id_idx" ON "policies" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_next_run_at_idx" ON "scheduled_tasks" USING btree ("next_run_at") WHERE enabled;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_telegram_user_id_key" ON "telegram_links" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "tool_executions_agent_id_idx" ON "tool_executions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_agent_id_idx" ON "transactions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_hash_idx" ON "transactions" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_passkey_credential_id_key" ON "users" USING btree ("passkey_credential_id");