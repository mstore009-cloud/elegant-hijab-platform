CREATE TABLE `order_contact_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`channel` enum('storefront','whatsapp','instagram','messenger','manual') NOT NULL,
	`outcome` enum('attempted','no_answer','customer_confirmed','customer_requested_change','cancelled') NOT NULL,
	`note` text,
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_contact_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `imageStorageKeySnapshot` varchar(512);--> statement-breakpoint
ALTER TABLE `orders` ADD `customerChannel` enum('storefront','whatsapp','instagram','messenger','manual') DEFAULT 'storefront' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `deliveryFee` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `manualDiscount` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `total` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_contact_events` ADD CONSTRAINT `order_contact_events_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_contact_events` ADD CONSTRAINT `order_contact_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `order_contact_order_idx` ON `order_contact_events` (`orderId`);--> statement-breakpoint
CREATE INDEX `order_contact_channel_idx` ON `order_contact_events` (`channel`);
