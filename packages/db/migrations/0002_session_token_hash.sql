ALTER TABLE "sessions" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");