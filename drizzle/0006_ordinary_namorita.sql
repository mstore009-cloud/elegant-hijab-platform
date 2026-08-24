CREATE TABLE `product_media_lifecycle_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`mediaId` int NOT NULL,
	`action` enum('operational_copy_created','operational_copy_regenerated','reference_detached','product_purged') NOT NULL,
	`result` enum('succeeded','skipped') NOT NULL DEFAULT 'succeeded',
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_media_lifecycle_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_media_lifecycle_events` ADD CONSTRAINT `product_media_lifecycle_events_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `media_lifecycle_product_idx` ON `product_media_lifecycle_events` (`productId`);--> statement-breakpoint
CREATE INDEX `media_lifecycle_media_idx` ON `product_media_lifecycle_events` (`mediaId`);