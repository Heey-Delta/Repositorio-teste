CREATE TABLE "editor_publications" (
	"slug" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"indexable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_publications_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "editor_publications" ADD CONSTRAINT "editor_publications_document_id_editor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."editor_documents"("id") ON DELETE cascade ON UPDATE no action;