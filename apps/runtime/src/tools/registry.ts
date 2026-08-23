/**
 * What a tool is, and the one door every tool call goes through.
 *
 * §6.1: *every tool is a schema, a handler, and a policy class*. Arguments are
 * validated before the gate sees them, so the gate is never reasoning about a
 * malformed shape — a rule this file enforces by making validation the only way
 * in rather than a step each handler is trusted to have taken.
 *
 * ## Placement: here for now, `packages/tools` and `packages/policy` later
 *
 * §4.1 puts the tool layer and the gate in their own packages, with a
 * dependency-direction test asserting that `agent` imports neither `core` nor
 * `custody`. That is still the intended shape and this is not a rejection of
 * it. Nothing outside this process consumes either yet, and two new workspaces
 * cost build wiring that buys nothing until something else imports them. When
 * `apps/telegram` arrives — §7.4 requires it to import no policy, custody or
 * chain module and to reach the runtime only over HTTP — the isolation it needs
 * is already a process boundary rather than a package one.
 *
 * The move is deliberate rather than forgotten: it is recorded in PLAN-V8's M4
 * run note, and the names to move to are in the paragraph above.
 *
 * ## One tool_executions row per call, written before the work
 *
 * The row is inserted before the handler runs, so a process that dies mid-turn
 * leaves a record of what it was doing rather than nothing at all. The decision
 * lands on it when the gate makes one, and the outcome when the handler
 * returns. A row that exists with no outcome is exactly what it looks like: a
 * call that started and did not finish.
 */

import { z } from 'zod';
import type { ReadOptions } from '@limen/chain';
import type { KeyProvider } from '@limen/custody';
import type { AgentForTurn, RuntimeStore } from '../store.js';
import type { ToolResult } from './types.js';

export interface ToolContext {
  agent: AgentForTurn;
  store: RuntimeStore;
  provider: KeyProvider;
  /** Reads are simulated from the agent's own funded account; it never signs for them. */
  read: ReadOptions;
  rpcUrl: string;
  /** The turn this call belongs to, for the in-flight marker a write leaves. */
  turnId: string;
  /** The `tool_executions` row, already inserted, for this call. */
  executionId: string;
}

export interface Tool<A> {
  name: string;
  /** `write` means it can move money. There is at most one per turn (§6.2). */
  kind: 'read' | 'write';
  /** Written for a model to read, and for a person to read in the docs. */
  description: string;
  schema: z.ZodType<A>;
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * A tool call that could not be understood.
 *
 * §4.4's first row: the model or the tool layer got it wrong, the user is told
 * so plainly, and **there is no hash** — nothing was attempted. Zod's issues
 * are flattened into one sentence because the caller is a language model or a
 * person, and neither is helped by a nested issue tree.
 */
function agentError(summary: string, detail: string): ToolResult {
  return { outcome: 'agent_error', summary, detail };
}

/**
 * A tool with its argument type erased, so a registry can hold two of them.
 *
 * `Tool<A>` is the shape a tool is *written* as — the schema and the handler
 * agree on one type, checked at the definition site. A map holding both
 * `Tool<PaymentArgs>` and `Tool<Record<string, never>>` has no such single
 * type, and the usual escape (a registry typed on `any`) discards the agreement
 * everywhere rather than at one point.
 *
 * `erase` keeps the agreement where it is checkable and gives up the type at
 * the boundary. Its one cast is immediately after the tool's own schema
 * validated the value, which is the only moment such a cast is honest.
 */
export interface ErasedTool {
  name: string;
  kind: 'read' | 'write';
  description: string;
  safeParse(raw: unknown): { ok: true; value: unknown } | { ok: false; issues: string };
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export function erase<A>(tool: Tool<A>): ErasedTool {
  return {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    safeParse(raw) {
      const parsed = tool.schema.safeParse(raw);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            // Flattened into one sentence: the caller is a language model or a
            // person, and neither is helped by a nested issue tree.
            issues: parsed.error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; '),
          };
    },
    run: (args, ctx) => tool.run(args as A, ctx),
  };
}

export function toolNames(tools: Record<string, ErasedTool>): string[] {
  return Object.keys(tools).sort();
}

/**
 * Validate, run, record.
 *
 * The handler never sees an argument object that failed its schema, and the
 * outcome is written to the tool's row whatever happens — including when the
 * handler throws, which is an infrastructure error and not a refusal.
 */
export async function invokeTool(
  tools: Record<string, ErasedTool>,
  name: string,
  rawArguments: unknown,
  context: Omit<ToolContext, 'executionId'>,
): Promise<ToolResult> {
  const tool = tools[name];
  if (tool === undefined) {
    return agentError(
      `There is no tool called ${JSON.stringify(name)}.`,
      `Known tools: ${toolNames(tools).join(', ')}.`,
    );
  }

  const parsed = tool.safeParse(rawArguments);
  if (!parsed.ok) {
    return agentError(`I could not work out what you meant by that ${name} call.`, parsed.issues);
  }

  const executionId = await context.store.recordToolExecution({
    agentId: context.agent.id,
    toolName: name,
    args: parsed.value,
  });

  let result: ToolResult;
  try {
    result = await tool.run(parsed.value, { ...context, executionId });
  } catch (error) {
    // Never a refusal. §4.4's fourth row: this did not reach the network, and
    // rendering it as a refusal would claim a boundary did something it did not.
    result = {
      outcome: 'infra_error',
      summary: 'This did not reach the network, so nothing was decided and nothing moved.',
      stage: error instanceof Error ? error.message : String(error),
    };
  }

  await context.store.completeToolExecution({ id: executionId, outcome: result.outcome });
  return result;
}
