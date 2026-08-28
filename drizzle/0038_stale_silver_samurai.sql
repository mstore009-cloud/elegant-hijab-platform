ALTER TABLE `channel_webhook_events` MODIFY COLUMN `eventType` enum('message','delivery_status','comment','mention','lead','publish_status','unsupported','account_event') NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` MODIFY COLUMN `processingStatus` enum('received','processed','ignored','failed','retry_pending','dead_letter') NOT NULL DEFAULT 'received';--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `normalizedPayloadJson` text;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `attemptCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `nextAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `lastAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `deadLetterAt` timestamp;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `deliveryStatus` enum('queued','sent','delivered','read','failed');--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `deliveredAt` timestamp;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `readAt` timestamp;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `failedAt` timestamp;--> statement-breakpoint
ALTER TABLE `inbox_messages` ADD `statusError` varchar(500);