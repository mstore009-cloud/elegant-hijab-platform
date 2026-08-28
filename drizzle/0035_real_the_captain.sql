CREATE TABLE `channel_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`channel` enum('whatsapp','instagram') NOT NULL,
	`providerAccountId` varchar(255),
	`providerDisplayName` varchar(160),
	`connectionStatus` enum('disconnected','testing','connected','disabled') NOT NULL DEFAULT 'disconnected',
	`lastInboundAt` timestamp,
	`lastError` varchar(500),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `channel_store_channel_unique` UNIQUE(`storeId`,`channel`),
	CONSTRAINT `channel_provider_unique` UNIQUE(`channel`,`providerAccountId`)
);
--> statement-breakpoint
CREATE TABLE `channel_webhook_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`channelAccountId` int NOT NULL,
	`externalEventId` varchar(255) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`eventType` enum('message','delivery_status','unsupported','account_event') NOT NULL,
	`processingStatus` enum('received','processed','ignored','failed') NOT NULL DEFAULT 'received',
	`errorSummary` varchar(500),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `channel_webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_account_event_unique` UNIQUE(`channelAccountId`,`externalEventId`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_image_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`mediaId` int NOT NULL,
	`sourceMessageId` int NOT NULL,
	`status` enum('pending','completed','failed','not_applicable') NOT NULL DEFAULT 'pending',
	`model` varchar(80),
	`confidence` int,
	`garmentType` varchar(120),
	`dominantColor` varchar(80),
	`secondaryColors` text,
	`pattern` varchar(160),
	`detectedText` varchar(500),
	`visualSummary` text,
	`suitableForMatching` boolean NOT NULL DEFAULT false,
	`errorSummary` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_image_analyses_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_image_analysis_media_unique` UNIQUE(`mediaId`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_image_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`analysisId` int NOT NULL,
	`productId` int NOT NULL,
	`productMediaId` int,
	`rank` int NOT NULL,
	`confidence` int NOT NULL,
	`matchReason` varchar(300) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_bot_image_matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_image_match_unique` UNIQUE(`analysisId`,`productId`)
);
--> statement-breakpoint
CREATE TABLE `inbox_message_media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`messageId` int NOT NULL,
	`channelAccountId` int,
	`providerMediaId` varchar(255),
	`mediaType` enum('image','video','audio','document','unsupported') NOT NULL,
	`mimeType` varchar(120),
	`originalFileName` varchar(255),
	`storageKey` varchar(512),
	`sizeBytes` int,
	`sha256` varchar(64),
	`downloadStatus` enum('pending','stored','failed','unsupported') NOT NULL DEFAULT 'pending',
	`errorSummary` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inbox_message_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_media_provider_unique` UNIQUE(`channelAccountId`,`providerMediaId`)
);
--> statement-breakpoint
ALTER TABLE `channel_accounts` ADD CONSTRAINT `channel_accounts_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_accounts` ADD CONSTRAINT `channel_accounts_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD CONSTRAINT `channel_webhook_events_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD CONSTRAINT `channel_webhook_events_channelAccountId_channel_accounts_id_fk` FOREIGN KEY (`channelAccountId`) REFERENCES `channel_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_analyses` ADD CONSTRAINT `customer_bot_image_analyses_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_analyses` ADD CONSTRAINT `customer_bot_image_analyses_mediaId_inbox_message_media_id_fk` FOREIGN KEY (`mediaId`) REFERENCES `inbox_message_media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_analyses` ADD CONSTRAINT `customer_bot_image_analyses_sourceMessageId_inbox_messages_id_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `inbox_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_matches` ADD CONSTRAINT `bot_img_match_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_matches` ADD CONSTRAINT `bot_img_match_analysis_fk` FOREIGN KEY (`analysisId`) REFERENCES `customer_bot_image_analyses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_matches` ADD CONSTRAINT `bot_img_match_product_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_image_matches` ADD CONSTRAINT `bot_img_match_media_fk` FOREIGN KEY (`productMediaId`) REFERENCES `product_media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_message_media` ADD CONSTRAINT `inbox_message_media_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_message_media` ADD CONSTRAINT `inbox_message_media_messageId_inbox_messages_id_fk` FOREIGN KEY (`messageId`) REFERENCES `inbox_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_message_media` ADD CONSTRAINT `inbox_message_media_channelAccountId_channel_accounts_id_fk` FOREIGN KEY (`channelAccountId`) REFERENCES `channel_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `channel_store_status_idx` ON `channel_accounts` (`storeId`,`connectionStatus`);--> statement-breakpoint
CREATE INDEX `webhook_store_status_time_idx` ON `channel_webhook_events` (`storeId`,`processingStatus`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `bot_image_analysis_store_msg_idx` ON `customer_bot_image_analyses` (`storeId`,`sourceMessageId`);--> statement-breakpoint
CREATE INDEX `bot_image_analysis_store_status_idx` ON `customer_bot_image_analyses` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `bot_image_match_store_analysis_idx` ON `customer_bot_image_matches` (`storeId`,`analysisId`,`rank`);--> statement-breakpoint
CREATE INDEX `message_media_store_message_idx` ON `inbox_message_media` (`storeId`,`messageId`);--> statement-breakpoint
CREATE INDEX `message_media_store_status_idx` ON `inbox_message_media` (`storeId`,`downloadStatus`);
