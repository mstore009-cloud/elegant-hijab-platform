CREATE TABLE `inbox_message_reactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`messageId` int NOT NULL,
	`externalEventId` varchar(255) NOT NULL,
	`targetExternalMessageId` varchar(255),
	`actorExternalId` varchar(255),
	`actorDisplayName` varchar(160),
	`emoji` varchar(32),
	`action` enum('added','removed') NOT NULL,
	`source` enum('live_webhook','historical_sync') NOT NULL DEFAULT 'live_webhook',
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inbox_message_reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_reaction_event_unique` UNIQUE(`storeId`,`externalEventId`)
);
--> statement-breakpoint
ALTER TABLE `inbox_message_reactions` ADD CONSTRAINT `inbox_message_reactions_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbox_message_reactions` ADD CONSTRAINT `inbox_message_reactions_messageId_inbox_messages_id_fk` FOREIGN KEY (`messageId`) REFERENCES `inbox_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inbox_reaction_message_idx` ON `inbox_message_reactions` (`storeId`,`messageId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `inbox_reaction_target_idx` ON `inbox_message_reactions` (`storeId`,`targetExternalMessageId`);