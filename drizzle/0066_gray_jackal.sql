CREATE TABLE `product_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`parentId` int,
	`name` varchar(180) NOT NULL,
	`source` enum('onedrive','manual') NOT NULL DEFAULT 'manual',
	`sourceFolderId` varchar(255),
	`sourcePath` varchar(1000) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`lastSeenAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_category_store_path_unique` UNIQUE(`storeId`,`sourcePath`),
	CONSTRAINT `product_category_store_folder_unique` UNIQUE(`storeId`,`sourceFolderId`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `categoryId` int;--> statement-breakpoint
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_parentId_product_categories_id_fk` FOREIGN KEY (`parentId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `product_category_store_parent_idx` ON `product_categories` (`storeId`,`parentId`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;