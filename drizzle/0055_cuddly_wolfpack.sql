CREATE TABLE `meta_catalog_export_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`connectionId` int NOT NULL,
	`catalogAssetId` int NOT NULL,
	`status` enum('pending','submitted','processing','completed','partial','failed') NOT NULL DEFAULT 'pending',
	`idempotencyKey` varchar(64) NOT NULL,
	`requestCount` int NOT NULL DEFAULT 0,
	`handle` varchar(255),
	`validationJson` text,
	`lastError` varchar(500),
	`createdByUserId` int,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_export_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_export_snapshot_unq` UNIQUE(`storeId`,`catalogAssetId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `meta_catalog_export_jobs` ADD CONSTRAINT `meta_catalog_export_jobs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_export_jobs` ADD CONSTRAINT `meta_catalog_export_jobs_connectionId_meta_connections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `meta_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_export_jobs` ADD CONSTRAINT `meta_catalog_export_jobs_catalogAssetId_meta_assets_id_fk` FOREIGN KEY (`catalogAssetId`) REFERENCES `meta_assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_export_jobs` ADD CONSTRAINT `meta_catalog_export_jobs_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_catalog_export_store_status_idx` ON `meta_catalog_export_jobs` (`storeId`,`status`,`createdAt`);