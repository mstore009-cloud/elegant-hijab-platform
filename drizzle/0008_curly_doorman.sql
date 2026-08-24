CREATE TABLE `catalog_folder_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`productFolderId` varchar(255) NOT NULL,
	`groupName` varchar(120) NOT NULL,
	`productCode` varchar(80) NOT NULL,
	`sourceReference` varchar(512) NOT NULL,
	`state` enum('discovered','draft_created','already_exists','needs_review','failed') NOT NULL,
	`linkedProductId` int,
	`missingFields` text,
	`imageCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`lastScannedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_folder_imports_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_folder_owner_unique` UNIQUE(`ownerUserId`,`productFolderId`)
);
--> statement-breakpoint
CREATE TABLE `catalog_sync_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`cronExpression` varchar(80) NOT NULL DEFAULT '0 */10 * * * *',
	`isEnabled` boolean NOT NULL DEFAULT true,
	`lastStartedAt` timestamp,
	`lastCompletedAt` timestamp,
	`lastSummary` text,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_sync_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_sync_settings_ownerUserId_unique` UNIQUE(`ownerUserId`)
);
--> statement-breakpoint
CREATE TABLE `product_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`actorUserId` int,
	`source` enum('catalog_scan','products_ui','whatsapp') NOT NULL,
	`action` varchar(80) NOT NULL,
	`changes` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD CONSTRAINT `catalog_folder_imports_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD CONSTRAINT `catalog_folder_imports_linkedProductId_products_id_fk` FOREIGN KEY (`linkedProductId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD CONSTRAINT `catalog_sync_settings_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_operations` ADD CONSTRAINT `product_operations_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_operations` ADD CONSTRAINT `product_operations_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `catalog_folder_state_idx` ON `catalog_folder_imports` (`state`);--> statement-breakpoint
CREATE INDEX `catalog_folder_product_idx` ON `catalog_folder_imports` (`linkedProductId`);--> statement-breakpoint
CREATE INDEX `catalog_sync_enabled_idx` ON `catalog_sync_settings` (`isEnabled`);--> statement-breakpoint
CREATE INDEX `product_operations_product_idx` ON `product_operations` (`productId`);--> statement-breakpoint
CREATE INDEX `product_operations_source_idx` ON `product_operations` (`source`);