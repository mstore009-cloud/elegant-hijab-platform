CREATE TABLE `meta_catalog_source_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`catalogFolderId` int,
	`status` enum('pending_review','media_prepared','exported','dismissed') NOT NULL DEFAULT 'pending_review',
	`sourceFingerprint` varchar(64) NOT NULL,
	`changesJson` text NOT NULL,
	`exportJobId` int,
	`detectedAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	`exportedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_source_updates_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_source_update_store_product_unq` UNIQUE(`storeId`,`productId`)
);
--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD `sourceFingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `meta_catalog_source_updates` ADD CONSTRAINT `meta_catalog_source_updates_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_source_updates` ADD CONSTRAINT `meta_catalog_source_updates_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_source_updates` ADD CONSTRAINT `meta_catalog_src_folder_fk` FOREIGN KEY (`catalogFolderId`) REFERENCES `catalog_folder_imports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_source_updates` ADD CONSTRAINT `meta_catalog_src_export_fk` FOREIGN KEY (`exportJobId`) REFERENCES `meta_catalog_export_jobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_catalog_source_update_store_status_idx` ON `meta_catalog_source_updates` (`storeId`,`status`,`updatedAt`);
