ALTER TABLE "authorization_codes"
ADD COLUMN IF NOT EXISTS "code_challenge" text,
ADD COLUMN IF NOT EXISTS "code_challenge_method" varchar(10);
