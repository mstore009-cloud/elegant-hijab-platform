CREATE TABLE `customer_bot_order_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`conversationId` int NOT NULL,
	`botRunId` int,
	`customerId` int,
	`status` enum('collecting','awaiting_confirmation','review_required','archived') NOT NULL DEFAULT 'collecting',
	`itemsJson` text NOT NULL,
	`customerName` varchar(160),
	`customerPhone` varchar(40),
	`governorate` varchar(120),
	`address` text,
	`subtotal` decimal(12,2),
	`deliveryFee` decimal(12,2),
	`total` decimal(12,2),
	`currencyCode` varchar(8) NOT NULL DEFAULT 'IQD',
	`summaryText` text,
	`missingFieldsJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_order_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `customer_bot_order_drafts` ADD CONSTRAINT `botod_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_order_drafts` ADD CONSTRAINT `botod_conv_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_order_drafts` ADD CONSTRAINT `botod_run_fk` FOREIGN KEY (`botRunId`) REFERENCES `customer_bot_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_order_drafts` ADD CONSTRAINT `botod_customer_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bot_order_draft_store_status_idx` ON `customer_bot_order_drafts` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_order_draft_conversation_idx` ON `customer_bot_order_drafts` (`storeId`,`conversationId`);--> statement-breakpoint
CREATE INDEX `bot_order_draft_run_idx` ON `customer_bot_order_drafts` (`botRunId`);
