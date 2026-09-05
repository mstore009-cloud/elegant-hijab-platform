ALTER TABLE `channel_accounts` DROP INDEX `channel_store_channel_unique`;--> statement-breakpoint
CREATE INDEX `channel_store_channel_idx` ON `channel_accounts` (`storeId`,`channel`);