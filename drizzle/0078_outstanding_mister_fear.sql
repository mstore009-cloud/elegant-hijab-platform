ALTER TABLE `meta_catalog_auto_sync_queue` MODIFY COLUMN `status` enum('pending','processing','completed','failed','ignored') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `products` ADD `lastMetaCatalogChangeAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `lastMetaCatalogChangeType` varchar(40);--> statement-breakpoint
ALTER TABLE `products` ADD `lastMetaCatalogChangeInternal` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `metaCatalogSyncIgnoredAt` timestamp;