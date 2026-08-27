CREATE TABLE `customer_bot_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`conversationId` int NOT NULL,
	`sourceMessageId` int,
	`route` enum('fast','escalated','human_handoff') NOT NULL,
	`status` enum('draft','handoff','failed','dismissed') NOT NULL,
	`model` varchar(80),
	`confidence` int,
	`escalationReason` varchar(120),
	`factsSnapshot` text,
	`replyDraft` text,
	`errorSummary` varchar(500),
	`promptTokens` int,
	`completionTokens` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_bot_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`mode` enum('draft_only','auto_reply') NOT NULL DEFAULT 'draft_only',
	`fastModel` varchar(80) NOT NULL DEFAULT 'gpt-5-mini',
	`escalationModel` varchar(80) NOT NULL DEFAULT 'gpt-5',
	`minimumConfidence` int NOT NULL DEFAULT 75,
	`maxDailyReplies` int NOT NULL DEFAULT 100,
	`maxDailyEscalations` int NOT NULL DEFAULT 15,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_settings_store_unique` UNIQUE(`storeId`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_usage_counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`usageDate` varchar(10) NOT NULL,
	`fastReplyCount` int NOT NULL DEFAULT 0,
	`escalationCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_usage_counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_usage_store_date_unique` UNIQUE(`storeId`,`usageDate`)
);
--> statement-breakpoint
ALTER TABLE `customer_bot_runs` ADD CONSTRAINT `customer_bot_runs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_runs` ADD CONSTRAINT `customer_bot_runs_conversationId_inbox_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_runs` ADD CONSTRAINT `customer_bot_runs_sourceMessageId_inbox_messages_id_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `inbox_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD CONSTRAINT `customer_bot_settings_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD CONSTRAINT `customer_bot_settings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_usage_counters` ADD CONSTRAINT `customer_bot_usage_counters_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bot_runs_store_conversation_time` ON `customer_bot_runs` (`storeId`,`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bot_runs_store_route_time` ON `customer_bot_runs` (`storeId`,`route`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bot_runs_source_message_idx` ON `customer_bot_runs` (`sourceMessageId`);