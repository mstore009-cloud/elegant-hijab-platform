ALTER TABLE `catalog_sync_settings` ADD `isRunning` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunStage` varchar(80);--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunProcessedFolders` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunTotalFolders` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunCurrentProduct` varchar(180);--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunDurationMs` int;--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `lastRunUpdatedAt` timestamp;