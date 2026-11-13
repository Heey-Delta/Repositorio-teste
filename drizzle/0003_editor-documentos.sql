CREATE TABLE "editor_actions" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "editor_actions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"client_id" text,
	"version" integer,
	"entries" jsonb NOT NULL,
	"login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"application" text NOT NULL,
	"doc" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "editor_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"label" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editor_actions" ADD CONSTRAINT "editor_actions_document_id_editor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."editor_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_versions" ADD CONSTRAINT "editor_versions_document_id_editor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."editor_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_actions_doc" ON "editor_actions" USING btree ("document_id","seq");--> statement-breakpoint
CREATE INDEX "editor_documents_owner" ON "editor_documents" USING btree ("owner","updated_at");--> statement-breakpoint
CREATE INDEX "editor_versions_doc" ON "editor_versions" USING btree ("document_id","created_at");