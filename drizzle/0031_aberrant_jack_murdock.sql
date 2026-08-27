CREATE TABLE `employee_bot_command_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`commandId` int NOT NULL,
	`reviewerUserId` int NOT NULL,
	`decision` enum('approved','rejected','needs_clarification') NOT NULL,
	`finalChanges` text,
	`note` text,
	`executedAt` timestamp,
	`executionError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_bot_command_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_bot_review_command_unique` UNIQUE(`commandId`)
);
--> statement-breakpoint
CREATE TABLE `employee_bot_command_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`commandId` int NOT NULL,
	`sourceType` enum('product','product_color','order') NOT NULL,
	`sourceId` int NOT NULL,
	`snapshot` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_bot_command_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_bot_commands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`requestedByUserId` int NOT NULL,
	`rawCommand` text NOT NULL,
	`intent` enum('inventory_set','selling_price_set','order_status_transition','clarification','unsupported') NOT NULL,
	`status` enum('needs_review','needs_clarification','approved','rejected','executed','execution_failed','expired') NOT NULL DEFAULT 'needs_review',
	`productId` int,
	`orderId` int,
	`targetLabel` varchar(220),
	`proposedChanges` text NOT NULL,
	`factsSnapshot` text NOT NULL,
	`model` varchar(120),
	`confidence` int,
	`escalationReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_bot_commands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `employee_bot_command_reviews` ADD CONSTRAINT `ebcr_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_command_reviews` ADD CONSTRAINT `ebcr_command_fk` FOREIGN KEY (`commandId`) REFERENCES `employee_bot_commands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_command_reviews` ADD CONSTRAINT `ebcr_reviewer_fk` FOREIGN KEY (`reviewerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_command_sources` ADD CONSTRAINT `ebcs_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_command_sources` ADD CONSTRAINT `ebcs_command_fk` FOREIGN KEY (`commandId`) REFERENCES `employee_bot_commands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_commands` ADD CONSTRAINT `ebc_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_commands` ADD CONSTRAINT `ebc_requester_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_commands` ADD CONSTRAINT `ebc_product_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_commands` ADD CONSTRAINT `ebc_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_bot_review_store_time_idx` ON `employee_bot_command_reviews` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `employee_bot_source_command_idx` ON `employee_bot_command_sources` (`commandId`);--> statement-breakpoint
CREATE INDEX `employee_bot_source_store_entity_idx` ON `employee_bot_command_sources` (`storeId`,`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `employee_bot_command_store_status_idx` ON `employee_bot_commands` (`storeId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `employee_bot_command_requester_idx` ON `employee_bot_commands` (`requestedByUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `employee_bot_command_product_idx` ON `employee_bot_commands` (`productId`);--> statement-breakpoint
CREATE INDEX `employee_bot_command_order_idx` ON `employee_bot_commands` (`orderId`);
