CREATE TABLE `content_post_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`postId` int NOT NULL,
	`actorUserId` int,
	`action` enum('created','updated','review_requested','approved','changes_requested','archived') NOT NULL,
	`note` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_post_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `content_posts` MODIFY COLUMN `status` enum('draft','needs_review','approved','changes_requested','archived') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `content_posts` ADD `title` varchar(200);--> statement-breakpoint
ALTER TABLE `content_posts` ADD `contentType` enum('feed_post','story','reel','catalog','other') DEFAULT 'feed_post' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_posts` ADD `channelPlan` enum('general','facebook','instagram','tiktok','whatsapp') DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_posts` ADD `plannedFor` timestamp;--> statement-breakpoint
ALTER TABLE `content_posts` ADD `reviewedByUserId` int;--> statement-breakpoint
ALTER TABLE `content_posts` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `content_posts` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `content_post_activities` ADD CONSTRAINT `content_post_activities_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_post_activities` ADD CONSTRAINT `content_post_activities_postId_content_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `content_posts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_post_activities` ADD CONSTRAINT `content_post_activities_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `content_activity_store_idx` ON `content_post_activities` (`storeId`);--> statement-breakpoint
CREATE INDEX `content_activity_post_idx` ON `content_post_activities` (`postId`);--> statement-breakpoint
CREATE INDEX `content_activity_post_time_idx` ON `content_post_activities` (`postId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `content_posts` ADD CONSTRAINT `content_posts_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `content_post_store_status_idx` ON `content_posts` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `content_post_store_planned_idx` ON `content_posts` (`storeId`,`plannedFor`);