CREATE TABLE `order_fulfillment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`fulfillmentId` int NOT NULL,
	`orderItemId` int,
	`type` enum('created','assigned','picking_started','item_picked','item_packed','ready','dispatched','delivered','exception_recorded','note_added') NOT NULL,
	`fromStage` varchar(32),
	`toStage` varchar(32),
	`note` text,
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_fulfillment_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_fulfillment_item_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fulfillmentId` int NOT NULL,
	`orderItemId` int NOT NULL,
	`pickedAt` timestamp,
	`pickedByUserId` int,
	`packedAt` timestamp,
	`packedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `order_fulfillment_item_checks_id` PRIMARY KEY(`id`),
	CONSTRAINT `fulfill_check_item_unique` UNIQUE(`fulfillmentId`,`orderItemId`)
);
--> statement-breakpoint
CREATE TABLE `order_fulfillments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`orderId` int NOT NULL,
	`stage` enum('unstarted','picking','packing','ready','dispatched','delivered','blocked') NOT NULL DEFAULT 'unstarted',
	`assignedEmployeeId` int,
	`exceptionNote` text,
	`startedAt` timestamp,
	`packedAt` timestamp,
	`readyAt` timestamp,
	`dispatchedAt` timestamp,
	`deliveredAt` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `order_fulfillments_id` PRIMARY KEY(`id`),
	CONSTRAINT `fulfillment_order_unique` UNIQUE(`orderId`)
);
--> statement-breakpoint
ALTER TABLE `order_fulfillment_events` ADD CONSTRAINT `ofe_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_events` ADD CONSTRAINT `ofe_fulfillment_fk` FOREIGN KEY (`fulfillmentId`) REFERENCES `order_fulfillments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_events` ADD CONSTRAINT `ofe_item_fk` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_events` ADD CONSTRAINT `ofe_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_item_checks` ADD CONSTRAINT `ofic_fulfillment_fk` FOREIGN KEY (`fulfillmentId`) REFERENCES `order_fulfillments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_item_checks` ADD CONSTRAINT `ofic_item_fk` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_item_checks` ADD CONSTRAINT `ofic_picker_fk` FOREIGN KEY (`pickedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillment_item_checks` ADD CONSTRAINT `ofic_packer_fk` FOREIGN KEY (`packedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillments` ADD CONSTRAINT `of_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillments` ADD CONSTRAINT `of_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillments` ADD CONSTRAINT `of_staff_fk` FOREIGN KEY (`assignedEmployeeId`) REFERENCES `employee_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_fulfillments` ADD CONSTRAINT `of_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fulfill_event_store_time_idx` ON `order_fulfillment_events` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `fulfill_event_fulfill_time_idx` ON `order_fulfillment_events` (`fulfillmentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `fulfill_check_fulfillment_idx` ON `order_fulfillment_item_checks` (`fulfillmentId`);--> statement-breakpoint
CREATE INDEX `fulfillment_store_stage_idx` ON `order_fulfillments` (`storeId`,`stage`);--> statement-breakpoint
CREATE INDEX `fulfillment_store_assignee_idx` ON `order_fulfillments` (`storeId`,`assignedEmployeeId`,`stage`);
