CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"network" text,
	"country_code" text NOT NULL,
	"region" text,
	"city" text,
	"email" text,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"submitter_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrections_status_idx" ON "corrections" USING btree ("status","created_at");