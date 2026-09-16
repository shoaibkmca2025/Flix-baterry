CREATE TYPE "public"."dealer_status" AS ENUM('pending_approval', 'active', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."login_outcome" AS ENUM('ok', 'bad_password', 'bad_otp', 'locked', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."mfa_type" AS ENUM('none', 'email_otp', 'totp');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'register', 'reset', 'admin_2fa', 'verify_mobile');--> statement-breakpoint
CREATE TYPE "public"."registered_via" AS ENUM('self', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_language" AS ENUM('en', 'mr');--> statement-breakpoint
CREATE TYPE "public"."user_scope" AS ENUM('dealer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'temporarily_blocked', 'inactive', 'soft_deleted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dealers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_code" text,
	"name" text NOT NULL,
	"contact_person" text NOT NULL,
	"mobile" text NOT NULL,
	"email" "citext",
	"city_id" uuid NOT NULL,
	"state" text NOT NULL,
	"pin" char(6) NOT NULL,
	"place" text,
	"address" text NOT NULL,
	"status" "dealer_status" DEFAULT 'pending_approval' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"registered_via" "registered_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dealers_dealer_code_unique" UNIQUE("dealer_code"),
	CONSTRAINT "dealers_mobile_unique" UNIQUE("mobile"),
	CONSTRAINT "dealers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"ip" "inet",
	"outcome" "login_outcome" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"target" text NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"scope" "user_scope" NOT NULL,
	"template_permissions" text[] NOT NULL,
	"system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"device_id" text,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"replaced_by" uuid,
	CONSTRAINT "sessions_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "user_scope" NOT NULL,
	"dealer_id" uuid,
	"name" text NOT NULL,
	"mobile" text,
	"email" "citext",
	"password_hash" text,
	"role" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"last_login_at" timestamp with time zone,
	"mfa" "mfa_type" DEFAULT 'none' NOT NULL,
	"totp_secret_enc" text,
	"language" "user_language" DEFAULT 'en' NOT NULL,
	"sms_alerts" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_mobile_unique" UNIQUE("mobile"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_scope_dealer_check" CHECK (("users"."scope" = 'dealer') = ("users"."dealer_id" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dealers" ADD CONSTRAINT "dealers_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealers_status_idx" ON "dealers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dealers_city_idx" ON "dealers" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_challenges_target_idx" ON "otp_challenges" USING btree ("target","purpose","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_permissions_uq" ON "user_permissions" USING btree ("user_id","permission");