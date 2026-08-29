#!/usr/bin/env node
/**
 * What a scheduled agent actually did, read from the database rather than a screen.
 *
 *     DATABASE_URL=… node scripts/schedule-report.mjs <agentId>
 *
 * The run record for the scheduler asks six questions, and a screen is the wrong
 * place to answer any of them: the detail page renders one agent's current
 * state, and every question below is about a *sequence* — which slots were
 * claimed, what each cycle decided, whether anything ran twice. So this reads
 * the rows.
 *
 * Nothing here is computed. Every line is a column, and the two derived numbers
 * — the slot spacing and the duplicate count — are derived by grouping rows, not
 * by trusting the scheduler's own account of itself. The hashes are printed as
 * Stellar Expert URLs so they can be opened against a public explorer that has
 * never heard of this repository, which is the same discipline
 * `verify-browser-run.mjs` states at greater length.
 */

import { neon } from '@neondatabase/serverless';

const agentId = process.argv[2];
if (agentId === undefined || agentId.length === 0) {
  console.error('usage: DATABASE_URL=… node scripts/schedule-report.mjs <agentId>');
  process.exit(1);
}
const url = (process.env.DATABASE_URL ?? '').trim();
if (url.length === 0) {
  console.error('schedule-report: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = neon(url);
const expert = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const head = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const [agent] = await sql`select id, name, status, trigger_json from agents where id=${agentId}`;
if (agent === undefined) {
  console.error(`schedule-report: no agent ${agentId}.`);
  process.exit(1);
}

head('agent');
console.log(`${agent.name}  ${agent.status}`);
console.log('trigger:', JSON.stringify(agent.trigger_json));

head('schedule');
const [task] = await sql`select * from scheduled_tasks where agent_id=${agentId}`;
if (task === undefined) console.log('(none)');
else
  console.log(
    `every ${task.interval_seconds}s  enabled=${task.enabled}  failures=${task.consecutive_failures}` +
      `${task.disabled_at === null ? '' : `  STOPPED ${task.disabled_at} (${task.disabled_reason})`}` +
      `\nnext ${task.next_run_at}  last ${task.last_run_at}`,
  );

head('turns, one line per cycle');
const turns = await sql`
  select id, status, outcome, due_at, scheduled_task_id, created_at, finished_at, result_json
    from turns where agent_id=${agentId} order by created_at`;
for (const t of turns) {
  const kind = t.scheduled_task_id === null ? 'by hand ' : 'schedule';
  const summary = (t.result_json?.summary ?? '').toString().replace(/\s+/g, ' ').slice(0, 72);
  console.log(`${t.created_at}  ${kind}  ${String(t.status).padEnd(7)} ${String(t.outcome).padEnd(18)} due=${t.due_at ?? '—'}`);
  if (summary.length > 0) console.log(`    ${summary}`);
}

head('nothing ran twice');
const slots = await sql`
  select due_at, count(*)::int c from turns
   where agent_id=${agentId} and due_at is not null group by due_at order by due_at`;
const dupes = slots.filter((s) => s.c > 1);
console.log(`${slots.length} slots claimed, ${dupes.length} with more than one turn` + (dupes.length === 0 ? '  ✓' : '  ✗'));
for (let i = 1; i < slots.length; i++) {
  const gap = (new Date(slots[i].due_at) - new Date(slots[i - 1].due_at)) / 1000;
  console.log(`  ${slots[i].due_at}  +${gap}s`);
}

head('cycles that decided not to trade');
const noTrade = await sql`
  select created_at, metadata_json from audit_events
   where action='trading.cycle' and result='no_trade' and actor_id=${agentId} order by created_at`;
console.log(`${noTrade.length} recorded as no_trade`);
for (const r of noTrade) console.log(`  ${r.created_at}  price=${r.metadata_json?.price}  ${r.metadata_json?.reason ?? ''}`);

head('the reference moving');
const restamps = await sql`
  select created_at, result, metadata_json from audit_events
   where action='trading.restamp' and actor_id=${agentId} order by created_at`;
console.log(`${restamps.length} restamp events`);
for (const r of restamps)
  console.log(`  ${r.created_at}  ${r.result}  from ${r.metadata_json?.referenceFrom} -> to ${r.metadata_json?.referenceTo} @ledger ${r.metadata_json?.referenceLedger}`);

head('transactions, with hashes to open');
const txs = await sql`
  select hash, reached_ledger, ledger, amount, asset, destination, op_result_name,
         contract_error_codes, is_boundary_refusal, is_revoked_rule, created_at
    from transactions where agent_id=${agentId} order by created_at`;
if (txs.length === 0) console.log('(none)');
for (const t of txs) {
  const verdict = t.is_boundary_refusal === true ? 'REFUSED BY THE BOUNDARY' : t.op_result_name ?? 'submitted';
  console.log(
    `  ${t.created_at}  ${verdict}  amount=${t.amount ?? '—'}  asset=${t.asset ?? '—'}  ` +
      `ledger=${t.ledger ?? '—'}  reachedLedger=${t.reached_ledger}` +
      `${t.contract_error_codes === null ? '' : `  codes=${JSON.stringify(t.contract_error_codes)}`}`,
  );
  console.log(`    ${t.hash === null ? '(no hash — refused before it reached a ledger)' : expert(t.hash)}`);
}

head('the schedule’s own history');
const sched = await sql`
  select action, result, created_at, metadata_json from audit_events
   where target=${agentId} and action like 'schedule.%' order by created_at`;
for (const r of sched) console.log(`  ${r.created_at}  ${r.action}  => ${r.result}`);
console.log();
