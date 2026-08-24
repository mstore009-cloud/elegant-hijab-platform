CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`productId` int NOT NULL,
	`variantId` int NOT NULL,
	`productCodeSnapshot` varchar(80) NOT NULL,
	`productNameSnapshot` varchar(220) NOT NULL,
	`colorNameSnapshot` varchar(100) NOT NULL,
	`unitPriceSnapshot` decimal(12,2) NOT NULL,
	`quantity` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_item_variant_unique` UNIQUE(`orderId`,`variantId`)
);
--> statement-breakpoint
CREATE TABLE `order_status_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`fromStatus` varchar(32),
	`toStatus` enum('new','needs_contact','confirmed','preparing','out_for_delivery','completed','cancelled') NOT NULL,
	`actorUserId` int,
	`source` enum('storefront','orders_ui','whatsapp') NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_status_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderNumber` varchar(40) NOT NULL,
	`status` enum('new','needs_contact','confirmed','preparing','out_for_delivery','completed','cancelled') NOT NULL DEFAULT 'new',
	`source` enum('storefront','manual','whatsapp') NOT NULL DEFAULT 'storefront',
	`customerName` varchar(160) NOT NULL,
	`customerPhone` varchar(40) NOT NULL,
	`governorate` varchar(120) NOT NULL,
	`address` text NOT NULL,
	`customerNote` text,
	`paymentMethod` enum('cash_on_delivery') NOT NULL DEFAULT 'cash_on_delivery',
	`subtotal` decimal(12,2) NOT NULL,
	`inventoryDeductedAt` timestamp,
	`confirmedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_orderNumber_unique` UNIQUE(`orderNumber`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_variantId_product_variants_id_fk` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_status_events` ADD CONSTRAINT `order_status_events_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_status_events` ADD CONSTRAINT `order_status_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_confirmedByUserId_users_id_fk` FOREIGN KEY (`confirmedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`orderId`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`productId`);--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_status_events` (`orderId`);--> statement-breakpoint
CREATE INDEX `order_events_status_idx` ON `order_status_events` (`toStatus`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`customerPhone`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`createdAt`);