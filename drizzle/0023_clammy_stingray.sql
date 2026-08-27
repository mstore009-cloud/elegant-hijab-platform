CREATE TABLE `inbox_conversation_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`conversationId` int NOT NULL,
	`type` enum('created','assigned','status_changed','priority_changed','snoozed','customer_linked','order_linked','message_recorded','internal_note_added') NOT NULL,
	`actorUserId` int,
	`fromValue` varchar(255),
	`toValue` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbox_conversation_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inbox_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`customerId` int,
	`orderId` int,
	`channel` enum('manual','whatsapp','instagram','messenger') NOT NULL DEFAULT 'manual',
	`externalConversationId` varchar(255),
	`contactNameSnapshot` varchar(160),
	`contactPhoneSnapshot` varchar(40),
	`subject` varchar(240),
	`status` enum('open','waiting_customer','snoozed','closed') NOT NULL DEFAULT 'open',
	`priority` boolean NOT NULL DEFAULT false,
	`assignedEmployeeId` int,
	`lastMessageAt` timestamp,
	`snoozedUntil` timestamp,
	`closedAt` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inbox_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_external_conversation_unique` UNIQUE(`storeId`,`channel`,`externalConversationId`)
);
--> statement-breakpoint
CREATE TABLE `inbox_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`direction` enum('inbound','outbound','internal_note','system') NOT NULL,
	`body` text NOT NULL,
	`externalMessageId` varchar(255),
	`actorUserId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbox_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_external_message_unique` UNIQUE(`conversationId`,`externalMessageId`)
);
--> statement-breakpoint
ALTER TABLE `inbox_conversation_events` ADD CONSTRAINT `inbox_ev_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversation_events` ADD CONSTRAINT `inbox_ev_conv_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversation_events` ADD CONSTRAINT `inbox_ev_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD CONSTRAINT `inbox_conv_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD CONSTRAINT `inbox_conv_customer_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD CONSTRAINT `inbox_conv_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD CONSTRAINT `inbox_conv_assignee_fk` FOREIGN KEY (`assignedEmployeeId`) REFERENCES `employee_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD CONSTRAINT `inbox_conv_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD CONSTRAINT `inbox_msg_conv_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD CONSTRAINT `inbox_msg_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inbox_event_store_conversation_time_idx` ON `inbox_conversation_events` (`storeId`,`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `inbox_event_conversation_idx` ON `inbox_conversation_events` (`conversationId`);--> statement-breakpoint
CREATE INDEX `inbox_store_status_recent_idx` ON `inbox_conversations` (`storeId`,`status`,`lastMessageAt`);--> statement-breakpoint
CREATE INDEX `inbox_store_assignee_status_idx` ON `inbox_conversations` (`storeId`,`assignedEmployeeId`,`status`);--> statement-breakpoint
CREATE INDEX `inbox_store_customer_idx` ON `inbox_conversations` (`storeId`,`customerId`);--> statement-breakpoint
CREATE INDEX `inbox_store_order_idx` ON `inbox_conversations` (`storeId`,`orderId`);--> statement-breakpoint
CREATE INDEX `inbox_message_conversation_time_idx` ON `inbox_messages` (`conversationId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `inbox_message_actor_idx` ON `inbox_messages` (`actorUserId`);
