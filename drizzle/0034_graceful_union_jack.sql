CREATE TABLE `product_financial_change_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`productId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`priorCostPrice` decimal(12,2),
	`nextCostPrice` decimal(12,2),
	`priorTargetMarginPercent` decimal(5,2),
	`nextTargetMarginPercent` decimal(5,2),
	`reason` varchar(360) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_financial_change_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `product_financial_change_events` ADD CONSTRAINT `pfin_change_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_financial_change_events` ADD CONSTRAINT `pfin_change_product_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_financial_change_events` ADD CONSTRAINT `pfin_change_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fin_change_store_created_idx` ON `product_financial_change_events` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `fin_change_product_created_idx` ON `product_financial_change_events` (`productId`,`createdAt`);
