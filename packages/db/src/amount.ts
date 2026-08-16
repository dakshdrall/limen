/**
 * Design rule 5 crossing the database boundary intact.
 *
 * The rule, as `@limen/core` states it: an amount is an integer in the token's
 * smallest unit, carried as `bigint`, and it never becomes a `number`. A
 * Stellar i128 runs to 39 decimal digits; IEEE-754 doubles are exact only to
 * 2^53, so a cap of 9,007,199,254,740,993 stroops silently becomes
 * 9,007,199,254,740,992 the moment it touches a float. For a value whose entire
 * job is to be the line an agent may not cross, being off by one in the
 * permissive direction is the worst available error.
 *
 * ## Why this is a type and not a convention
 *
 * "Every amount is `NUMERIC`, handled as `bigint`" is a sentence somebody has
 * to remember. This is the same sentence as a compiler error. A column declared
 * with `amount()` cannot be read as a `number` — Drizzle infers `bigint` from
 * the type parameter — and cannot be written from one either.
 *
 * The three ways an amount could become a float here, all closed:
 *
 *   - **`double precision` / `real` columns.** Not used anywhere; a schema test
 *     asserts no column in any table has a floating-point type, which is
 *     stronger than asserting that the ones we thought of do not.
 *   - **`bigint` columns read through the driver.** `node-postgres` returns
 *     `int8` as a *string* by default and both drivers can be configured to
 *     parse it to a JS `number`, which is the exact loss above. Sidestepped by
 *     not using `int8` for amounts at all.
 *   - **`numeric` read as a number.** `numeric` arrives as a string from both
 *     drivers, and the parse below is `BigInt(string)`, which throws on a
 *     fractional value rather than truncating it.
 *
 * ## Why `numeric(39, 0)` and not `int8`
 *
 * `int8` is 64-bit and a Soroban i128 is not. A cap above 2^63-1 is
 * representable on chain, expressible in a context rule, and would fail to
 * store — which would be a write error at best and a silently clamped
 * authorization at worst. 39 digits covers the full i128 range with the scale
 * pinned at zero, so the column cannot hold a fraction of a stroop even if
 * something tried to write one.
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * An integer amount in a token's smallest unit.
 *
 * Stored as `numeric(39, 0)`, surfaced as `bigint`, and never as anything else.
 */
export const amount = customType<{ data: bigint; driverData: string }>({
  dataType() {
    return 'numeric(39, 0)';
  },

  /**
   * Postgres hands back `numeric` as a string, from both access paths. Anything
   * with a fractional part throws here rather than being rounded: a value that
   * should not exist must not be quietly turned into a nearby one that could.
   */
  fromDriver(value: string): bigint {
    return BigInt(value);
  },

  /**
   * `bigint` stringifies without an exponent at every magnitude, which `number`
   * does not — `1e21` is what a float of that size would send, and Postgres
   * would take it. The type parameter makes this the only reachable input.
   */
  toDriver(value: bigint): string {
    return value.toString();
  },
});
