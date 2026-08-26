ALTER TABLE `content_posts` ADD `storeId` int;--> statement-breakpoint
UPDATE `content_posts`
SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1)
WHERE `storeId` IS NULL;--> statement-breakpoint
ALTER TABLE `content_posts` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `content_posts` ADD CONSTRAINT `content_posts_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `content_post_store_idx` ON `content_posts` (`storeId`);
