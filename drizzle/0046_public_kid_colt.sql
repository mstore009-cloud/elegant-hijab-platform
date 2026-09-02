CREATE TABLE `meta_history_sync_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`connectionId` int NOT NULL,
	`channelAccountId` int NOT NULL,
	`channel` enum('messenger','instagram','whatsapp') NOT NULL,
	`providerAccountId` varchar(255) NOT NULL,
	`status` enum('pending','running','paused','retry_pending','completed','failed','unsupported') NOT NULL DEFAULT 'pending',
	`stage` enum('conversations','messages','history_webhook','complete') NOT NULL DEFAULT 'conversations',
	`cursor` text,
	`currentConversationExternalId` varchar(255),
	`processedConversations` int NOT NULL DEFAULT 0,
	`processedMessages` int NOT NULL DEFAULT 0,
	`duplicateMessages` int NOT NULL DEFAULT 0,
	`failedItems` int NOT NULL DEFAULT 0,
	`oldestMessageAt` timestamp,
	`newestMessageAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lastRunAt` timestamp,
	`completedAt` timestamp,
	`lastError` varchar(500),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_history_sync_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_history_store_channel_account_unq` UNIQUE(`storeId`,`channel`,`providerAccountId`)
);
--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `source` enum('manual','live_webhook','historical_sync','outbound') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_history_sync_jobs` ADD CONSTRAINT `meta_history_sync_jobs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_history_sync_jobs` ADD CONSTRAINT `meta_history_sync_jobs_connectionId_meta_connections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `meta_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_history_sync_jobs` ADD CONSTRAINT `meta_history_sync_jobs_channelAccountId_channel_accounts_id_fk` FOREIGN KEY (`channelAccountId`) REFERENCES `channel_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_history_sync_jobs` ADD CONSTRAINT `meta_history_sync_jobs_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_history_store_status_retry_idx` ON `meta_history_sync_jobs` (`storeId`,`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `meta_history_connection_idx` ON `meta_history_sync_jobs` (`connectionId`,`channel`);