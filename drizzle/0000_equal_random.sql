CREATE TABLE "revisions" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"record" jsonb NOT NULL,
	"thumbnail" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
