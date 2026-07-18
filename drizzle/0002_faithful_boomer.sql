CREATE FUNCTION immutable_tags_text(tags text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN coalesce(array_to_string(tags, ' '), '');--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_model_id_pk" PRIMARY KEY("user_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "model_revisions" (
	"model_id" text NOT NULL,
	"revision_id" char(24) NOT NULL,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_revisions_model_id_version_pk" PRIMARY KEY("model_id","version")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"license" text DEFAULT 'CC-BY-4.0' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"head_revision_id" char(24) NOT NULL,
	"forked_from_model_id" text,
	"forked_from_revision_id" char(24),
	"like_count" integer DEFAULT 0 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("models"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("models"."description", '')), 'B') || setweight(to_tsvector('english', immutable_tags_text("models"."tags")), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_head_revision_id_revisions_id_fk" FOREIGN KEY ("head_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_forked_from_model_id_models_id_fk" FOREIGN KEY ("forked_from_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_forked_from_revision_id_revisions_id_fk" FOREIGN KEY ("forked_from_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "models_owner_slug_unique" ON "models" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "models_search_index" ON "models" USING gin ("search");