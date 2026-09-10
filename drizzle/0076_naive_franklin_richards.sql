CREATE TABLE `meta_catalog_auto_sync_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`requestedByUserId` int,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lastError` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_auto_sync_queue_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_auto_sync_store_product_unq` UNIQUE(`storeId`,`productId`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `lastMetaCatalogSyncAt` timestamp;--> statement-breakpoint
ALTER TABLE `meta_catalog_auto_sync_queue` ADD CONSTRAINT `meta_catalog_auto_sync_queue_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_auto_sync_queue` ADD CONSTRAINT `meta_catalog_auto_sync_queue_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_auto_sync_queue` ADD CONSTRAINT `meta_catalog_auto_sync_queue_requestedByUserId_users_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_catalog_auto_sync_pending_idx` ON `meta_catalog_auto_sync_queue` (`storeId`,`status`,`nextAttemptAt`);