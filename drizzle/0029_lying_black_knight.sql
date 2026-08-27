CREATE TABLE `notification_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`userId` int NOT NULL,
	`inboxAssignments` boolean NOT NULL DEFAULT true,
	`botHandoffs` boolean NOT NULL DEFAULT true,
	`crmTasks` boolean NOT NULL DEFAULT true,
	`reviewRequests` boolean NOT NULL DEFAULT true,
	`orderUpdates` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_preferences_store_user_unique` UNIQUE(`storeId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `work_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`recipientUserId` int NOT NULL,
	`type` enum('inbox_assigned','bot_handoff','crm_task_assigned','content_review_requested','marketing_approval_requested','loyalty_reward_review_requested','order_created') NOT NULL,
	`priority` enum('info','action','urgent') NOT NULL DEFAULT 'info',
	`title` varchar(220) NOT NULL,
	`body` text,
	`entityType` varchar(80) NOT NULL,
	`entityId` int NOT NULL,
	`route` varchar(500) NOT NULL,
	`dedupeKey` varchar(160),
	`readAt` timestamp,
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_store_user_dedupe_unique` UNIQUE(`storeId`,`recipientUserId`,`dedupeKey`)
);
--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_notifications` ADD CONSTRAINT `work_notifications_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_notifications` ADD CONSTRAINT `work_notifications_recipientUserId_users_id_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notification_recipient_inbox_idx` ON `work_notifications` (`storeId`,`recipientUserId`,`archivedAt`,`readAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notification_entity_idx` ON `work_notifications` (`storeId`,`entityType`,`entityId`);