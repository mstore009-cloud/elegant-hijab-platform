CREATE TABLE `content_post_media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`originalFileName` varchar(255) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`byteSize` int NOT NULL,
	`linkedProductMediaId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_post_media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `content_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int,
	`status` enum('draft') NOT NULL DEFAULT 'draft',
	`caption` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `content_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `content_post_media` ADD CONSTRAINT `content_post_media_postId_content_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `content_posts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_post_media` ADD CONSTRAINT `content_post_media_linkedProductMediaId_product_media_id_fk` FOREIGN KEY (`linkedProductMediaId`) REFERENCES `product_media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_posts` ADD CONSTRAINT `content_posts_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_posts` ADD CONSTRAINT `content_posts_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `content_post_media_post_idx` ON `content_post_media` (`postId`);--> statement-breakpoint
CREATE INDEX `content_post_media_product_media_idx` ON `content_post_media` (`linkedProductMediaId`);--> statement-breakpoint
CREATE INDEX `content_post_product_idx` ON `content_posts` (`productId`);--> statement-breakpoint
CREATE INDEX `content_post_creator_idx` ON `content_posts` (`createdByUserId`);