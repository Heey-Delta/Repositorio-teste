CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" uuid NOT NULL,
	"visitor" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_visitor_pk" PRIMARY KEY("post_id","visitor")
);
--> statement-breakpoint
CREATE TABLE "search_vectors" (
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_vectors_kind_ref_id_pk" PRIMARY KEY("kind","ref_id")
);
--> statement-breakpoint
CREATE TABLE "volume_posts" (
	"volume_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "volume_posts_volume_id_post_id_pk" PRIMARY KEY("volume_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover_media_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "volumes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_posts" ADD CONSTRAINT "volume_posts_volume_id_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."volumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_posts" ADD CONSTRAINT "volume_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_likes_ip" ON "post_likes" USING btree ("ip_hash","created_at");