CREATE TABLE `meta_catalog_enrichment_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`brand` varchar(100),
	`currency` varchar(3) NOT NULL DEFAULT 'IQD',
	`condition` enum('new','refurbished','used') NOT NULL DEFAULT 'new',
	`defaultFbProductCategory` varchar(500),
	`defaultGoogleProductCategory` varchar(250),
	`defaultGender` enum('female','male','unisex'),
	`defaultAgeGroup` enum('newborn','infant','toddler','kids','teen','adult','all ages'),
	`productLinkBaseUrl` varchar(2048),
	`defaultProductType` varchar(750),
	`defaultAvailability` enum('in stock','out of stock','available for order','discontinued') NOT NULL DEFAULT 'in stock',
	`mediaPolicy` enum('catalog_high_quality','operational_fallback') NOT NULL DEFAULT 'catalog_high_quality',
	`createdByUserId` int,
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_enrichment_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_enrichment_store_unq` UNIQUE(`storeId`)
);
--> statement-breakpoint
CREATE TABLE `meta_catalog_product_enrichments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`fbProductCategory` varchar(500),
	`googleProductCategory` varchar(250),
	`material` varchar(200),
	`pattern` varchar(100),
	`gender` enum('female','male','unisex'),
	`ageGroup` enum('newborn','infant','toddler','kids','teen','adult','all ages'),
	`productType` varchar(750),
	`productLink` varchar(2048),
	`exportEnabled` boolean NOT NULL DEFAULT true,
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_product_enrichments_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_product_enrichment_store_product_unq` UNIQUE(`storeId`,`productId`)
);
--> statement-breakpoint
ALTER TABLE `meta_catalog_enrichment_settings` ADD CONSTRAINT `meta_catalog_enrichment_settings_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_enrichment_settings` ADD CONSTRAINT `meta_catalog_enrichment_settings_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_enrichment_settings` ADD CONSTRAINT `meta_catalog_enrichment_settings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_product_enrichments` ADD CONSTRAINT `meta_catalog_product_enrichments_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_product_enrichments` ADD CONSTRAINT `meta_catalog_product_enrichments_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_product_enrichments` ADD CONSTRAINT `meta_catalog_product_enrichments_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_catalog_product_enrichment_store_idx` ON `meta_catalog_product_enrichments` (`storeId`);