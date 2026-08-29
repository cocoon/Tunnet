BEGIN;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "issuer" text;
--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "provider_id" = 'credential'
  AND "account_id" = "user_id";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "account" WHERE "issuer" IS NULL) THEN
    RAISE EXCEPTION
      'Better Auth 1.7 account migration blocked: every account must have a reviewed issuer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "issuer", "account_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Better Auth 1.7 account migration blocked: issuer/account_id collisions exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uidx"
  ON "account" USING btree ("issuer", "account_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "device_code" GROUP BY "device_code" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "device_code" GROUP BY "user_code" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Better Auth 1.7 device-code migration blocked: duplicate lookup codes exist';
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX "device_code_device_code_idx";
--> statement-breakpoint
DROP INDEX "device_code_user_code_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_device_code_uidx"
  ON "device_code" USING btree ("device_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_user_code_uidx"
  ON "device_code" USING btree ("user_code");
--> statement-breakpoint
COMMIT;
