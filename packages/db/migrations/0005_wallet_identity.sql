-- Wallet sign-in: a third way to prove identity, and somewhere to keep it.
--
-- Freighter signs a challenge, the server verifies it against the `G…` address
-- with SEP-53, and that address becomes the user. This adds the two things the
-- schema was missing for that: a value in `auth_method` to name the method, and
-- a column to hold the address.
--
-- Both are additive. No existing row changes, no existing query changes, and
-- nothing here touches how an account is *owned* — `agent_accounts`
-- `owner_signer_kind` is still the browser's disposable ed25519 key, and wallet
-- sign-in does not alter it. The README's "The wallet button, and what it does
-- not do" is the copy that has to stay true to this, and the F4 measurement it
-- cites is unaffected: a wallet still cannot be an `External` signer.
--
-- `ADD VALUE` cannot run inside a transaction block on PostgreSQL before 12,
-- and it cannot be used in the same transaction that then writes the new value
-- on any version. Neither applies here — the migration runner sends these as
-- separate statements and no row is inserted with `'wallet'` until an actual
-- sign-in happens, which is a different connection entirely.
ALTER TYPE "auth_method" ADD VALUE IF NOT EXISTS 'wallet';

-- Nullable, because every existing user is a passkey user and has no address.
-- There is no default and no backfill for the same reason: an address that was
-- invented rather than signed for would be an identity nobody holds the key to.
ALTER TABLE "users" ADD COLUMN "stellar_address" text;

-- One address is one account. Without this, two concurrent first-time sign-ins
-- from the same wallet would create two users, and the second would silently
-- own none of the first's agents.
--
-- Unique rather than a primary key, and nullable alongside it: PostgreSQL
-- treats NULLs as distinct in a unique index, so every passkey user keeps its
-- NULL without colliding with the others. That is the same property
-- `users_passkey_credential_id_key` already relies on for wallet users.
CREATE UNIQUE INDEX "users_stellar_address_key" ON "users" ("stellar_address");
