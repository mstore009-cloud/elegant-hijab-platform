CREATE TABLE `meta_catalog_group_enrichments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`groupPath` varchar(1000) NOT NULL,
	`fbProductCategory` varchar(500),
	`pattern` varchar(100),
	`gender` enum('female','male','unisex'),
	`ageGroup` enum('newborn','infant','toddler','kids','teen','adult','all ages'),
	`productLink` varchar(2048),
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_catalog_group_enrichments_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_catalog_group_enrichment_store_path_unq` UNIQUE(`storeId`,`groupPath`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `material` varchar(200);--> statement-breakpoint
ALTER TABLE `meta_catalog_group_enrichments` ADD CONSTRAINT `meta_catalog_group_enrichments_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_catalog_group_enrichments` ADD CONSTRAINT `meta_catalog_group_enrichments_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_catalog_group_enrichment_store_idx` ON `meta_catalog_group_enrichments` (`storeId`);