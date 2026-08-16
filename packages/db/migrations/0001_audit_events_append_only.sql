-- Append-only, as a privilege rather than as a convention.
--
-- PLAN-V8 Part V: `AuditEvent` is append-only; no UPDATE or DELETE grant on
-- this table for the app role. This migration is hand-written because a schema
-- DSL describes tables and this is about who may do what to one — drizzle-kit
-- has nothing to diff here, and a generated file would not carry the reasoning.
--
-- A HAND-WRITTEN MIGRATION IS INVISIBLE TO drizzle-kit's DIFF
--
-- `drizzle-kit generate` diffs `schema.ts` against the newest snapshot in
-- `meta/`, and a hand-written migration writes no snapshot. That is harmless
-- here — this file creates no schema object, so there is nothing for a later
-- diff to miss. It would not be harmless for a hand-written migration that
-- added a table or a column: the next generated migration would try to create
-- it again. If one is ever needed, add the object in `schema.ts` and let
-- drizzle-kit generate it, then hand-write only what the DSL cannot express.
--
-- `test/schema.test.ts` covers hand-written migrations separately for the same
-- reason, by scanning the raw DDL of every file here rather than trusting the
-- snapshot to describe all of them.
--
-- WHY A GRANT AND NOT A TRIGGER
--
-- A `BEFORE UPDATE ... RAISE EXCEPTION` trigger would also stop an UPDATE, and
-- would be removable by the same connection that wanted to run one. The point
-- of this table is the case where somebody is asking what happened and the
-- answer is contested; a defence the application can drop on its way past is
-- not a defence. A privilege the application does not hold cannot be granted to
-- itself.
--
-- WHAT THIS DOES NOT PROTECT AGAINST, STATED PLAINLY
--
-- The table owner. In Postgres the owner has every privilege on its own tables
-- regardless of grants, and can `ALTER TABLE ... OWNER TO` besides. So this is
-- only true if **the application does not connect as the owner**, which is a
-- deployment fact and not a schema fact:
--
--   * migrations connect as the owner, through the direct endpoint;
--   * the application connects as a role that is a member of `limen_app` and
--     owns nothing.
--
-- `test/append-only.test.ts` proves the property the only way it can be proved
-- — by connecting as a non-owner member of `limen_app` and watching UPDATE and
-- DELETE on `audit_events` be refused, while INSERT and SELECT succeed and
-- UPDATE on another table succeeds. A grant that is never exercised as the role
-- it constrains is a statement about SQL that was typed, not about access that
-- was refused.

-- NOLOGIN, deliberately. This is a group role that carries the privileges; the
-- deployment creates its own login role and grants membership. That keeps every
-- credential out of a migration file, which is where credentials go to be
-- committed by accident.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'limen_app') THEN
    CREATE ROLE limen_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO limen_app;--> statement-breakpoint

-- Everything the application legitimately mutates.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  sessions,
  telegram_links,
  agents,
  agent_accounts,
  agent_keys,
  policies,
  conversations,
  messages,
  tool_executions,
  transactions,
  scheduled_tasks,
  idempotency_keys
TO limen_app;--> statement-breakpoint

-- And the one it does not. Note what is absent rather than revoked: the grant
-- was never made, so there is no `REVOKE` here that a later migration could be
-- read as undoing.
GRANT SELECT, INSERT ON audit_events TO limen_app;--> statement-breakpoint

-- No `ALTER DEFAULT PRIVILEGES`. A blanket default would silently grant UPDATE
-- and DELETE on every table added after this one — including a second audit
-- table, which is exactly the case that would matter. Each future table names
-- its own grant in the migration that creates it, which is one more line and
-- one fewer thing that happens to you.
