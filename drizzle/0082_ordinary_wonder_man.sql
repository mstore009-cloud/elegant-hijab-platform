CREATE TABLE `customer_bot_training_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`kind` enum('text','audio') NOT NULL,
	`status` enum('ready','failed') NOT NULL DEFAULT 'ready',
	`storageKey` varchar(512) NOT NULL,
	`originalFileName` varchar(255) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`byteSize` int NOT NULL,
	`transcript` text,
	`errorSummary` varchar(500),
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_bot_training_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `customer_bot_training_assets` ADD CONSTRAINT `customer_bot_training_assets_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_training_assets` ADD CONSTRAINT `customer_bot_training_assets_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bot_training_asset_store_time_idx` ON `customer_bot_training_assets` (`storeId`,`createdAt`);