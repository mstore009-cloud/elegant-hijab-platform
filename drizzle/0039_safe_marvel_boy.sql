ALTER TABLE `channel_webhook_events` MODIFY COLUMN `channelAccountId` int;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD `metaAssetId` int;--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD CONSTRAINT `webhook_asset_event_unique` UNIQUE(`metaAssetId`,`externalEventId`);--> statement-breakpoint
ALTER TABLE `channel_webhook_events` ADD CONSTRAINT `channel_webhook_events_metaAssetId_meta_assets_id_fk` FOREIGN KEY (`metaAssetId`) REFERENCES `meta_assets`(`id`) ON DELETE no action ON UPDATE no action;