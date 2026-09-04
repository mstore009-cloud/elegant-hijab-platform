CREATE INDEX `message_media_message_idx` ON `inbox_message_media` (`messageId`);--> statement-breakpoint
CREATE INDEX `message_media_channel_account_idx` ON `inbox_message_media` (`channelAccountId`);--> statement-breakpoint
ALTER TABLE `inbox_message_media` DROP INDEX `message_media_provider_unique`;--> statement-breakpoint
ALTER TABLE `inbox_message_media` ADD CONSTRAINT `message_media_provider_unique` UNIQUE(`channelAccountId`,`providerMediaId`,`messageId`);