CREATE TABLE `product_import_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` enum('onedrive','manual') NOT NULL,
	`sourceReference` varchar(512),
	`status` enum('pending','processing','needs_review','completed','failed') NOT NULL DEFAULT 'pending',
	`linkedProductId` int,
	`missingFields` text,
	`errorSummary` text,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_import_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`variantId` int,
	`source` enum('onedrive','manual','s3') NOT NULL,
	`mediaType` enum('image','video','document') NOT NULL,
	`originalUrl` text,
	`storageKey` varchar(512),
	`originalFileName` varchar(255),
	`colorVerified` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`colorName` varchar(100) NOT NULL,
	`sizeLabel` varchar(80) NOT NULL DEFAULT '',
	`inventoryQuantity` int NOT NULL DEFAULT 0,
	`availability` enum('available','low_stock','out_of_stock') NOT NULL DEFAULT 'available',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_variant_unique` UNIQUE(`productId`,`colorName`,`sizeLabel`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productCode` varchar(80) NOT NULL,
	`name` varchar(220) NOT NULL,
	`category` varchar(120),
	`description` text,
	`status` enum('draft','needs_review','ready','active','archived') NOT NULL DEFAULT 'draft',
	`sellingPrice` decimal(12,2) NOT NULL,
	`costPrice` decimal(12,2),
	`targetMarginPercent` decimal(5,2),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_productCode_unique` UNIQUE(`productCode`)
);
--> statement-breakpoint
ALTER TABLE `product_import_jobs` ADD CONSTRAINT `product_import_jobs_linkedProductId_products_id_fk` FOREIGN KEY (`linkedProductId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_import_jobs` ADD CONSTRAINT `product_import_jobs_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_media` ADD CONSTRAINT `product_media_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_media` ADD CONSTRAINT `product_media_variantId_product_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `import_job_status_idx` ON `product_import_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `import_job_product_idx` ON `product_import_jobs` (`linkedProductId`);--> statement-breakpoint
CREATE INDEX `media_product_idx` ON `product_media` (`productId`);--> statement-breakpoint
CREATE INDEX `media_variant_idx` ON `product_media` (`variantId`);--> statement-breakpoint
CREATE INDEX `variant_product_idx` ON `product_variants` (`productId`);--> statement-breakpoint
CREATE INDEX `product_status_idx` ON `products` (`status`);--> statement-breakpoint
CREATE INDEX `product_category_idx` ON `products` (`category`);