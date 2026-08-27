CREATE INDEX `catalog_folder_owner_idx` ON `catalog_folder_imports` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `catalog_sync_owner_idx` ON `catalog_sync_settings` (`ownerUserId`);--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` DROP INDEX `catalog_folder_owner_unique`;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` DROP INDEX `catalog_sync_settings_ownerUserId_unique`;--> statement-breakpoint
ALTER TABLE `products` DROP INDEX `products_productCode_unique`;--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `product_import_jobs` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `products` ADD `storeId` int;--> statement-breakpoint
UPDATE `catalog_folder_imports` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `catalog_sync_settings` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `product_import_jobs` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `products` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `product_import_jobs` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD CONSTRAINT `catalog_folder_store_unique` UNIQUE(`storeId`,`productFolderId`);--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD CONSTRAINT `catalog_sync_store_unique` UNIQUE(`storeId`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `product_store_code_unique` UNIQUE(`storeId`,`productCode`);--> statement-breakpoint
ALTER TABLE `catalog_folder_imports` ADD CONSTRAINT `catalog_folder_imports_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD CONSTRAINT `catalog_sync_settings_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_import_jobs` ADD CONSTRAINT `product_import_jobs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `import_job_store_status_idx` ON `product_import_jobs` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `product_store_status_idx` ON `products` (`storeId`,`status`);
