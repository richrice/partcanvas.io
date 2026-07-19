CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_model_created_index" ON "comments" USING btree ("model_id","created_at");