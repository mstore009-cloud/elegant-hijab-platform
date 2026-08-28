CREATE TABLE `meta_outbound_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`channelAccountId` int NOT NULL,
	`conversationId` int NOT NULL,
	`inboxMessageId` int,
	`channel` enum('whatsapp','instagram','messenger') NOT NULL,
	`recipientExternalId` varchar(255) NOT NULL,
	`idempotencyKey` varchar(64) NOT NULL,
	`mode` enum('manual','bot_guarded','comment_guarded') NOT NULL,
	`body` text NOT NULL,
	`status` enum('queued','sending','sent','failed','blocked') NOT NULL DEFAULT 'queued',
	`externalMessageId` varchar(255),
	`actorUserId` int,
	`botRunId` int,
	`errorCode` varchar(120),
	`errorSummary` varchar(500),
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_outbound_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_outbound_idempotency_unique` UNIQUE(`storeId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_channel_fk` FOREIGN KEY (`channelAccountId`) REFERENCES `channel_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_conversation_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_message_fk` FOREIGN KEY (`inboxMessageId`) REFERENCES `inbox_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD CONSTRAINT `meta_out_bot_run_fk` FOREIGN KEY (`botRunId`) REFERENCES `customer_bot_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_outbound_store_status_idx` ON `meta_outbound_messages` (`storeId`,`status`,`requestedAt`);--> statement-breakpoint
CREATE INDEX `meta_outbound_conversation_idx` ON `meta_outbound_messages` (`conversationId`,`requestedAt`);
