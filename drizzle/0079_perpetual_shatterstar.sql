CREATE TABLE `product_visual_references` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`productMediaId` int NOT NULL,
	`referenceType` enum('primary','color','detail') NOT NULL DEFAULT 'color',
	`sortOrder` int NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_visual_references_id` PRIMARY KEY(`id`),
	CONSTRAINT `visual_reference_media_unique` UNIQUE(`productMediaId`)
);
--> statement-breakpoint
ALTER TABLE `product_visual_references` ADD CONSTRAINT `product_visual_references_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_visual_references` ADD CONSTRAINT `product_visual_references_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_visual_references` ADD CONSTRAINT `product_visual_references_productMediaId_product_media_id_fk` FOREIGN KEY (`productMediaId`) REFERENCES `product_media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_visual_references` ADD CONSTRAINT `product_visual_references_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `visual_reference_store_product_idx` ON `product_visual_references` (`storeId`,`productId`,`enabled`,`sortOrder`);