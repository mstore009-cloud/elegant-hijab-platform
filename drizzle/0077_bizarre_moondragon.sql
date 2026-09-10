ALTER TABLE `catalog_sync_settings` ADD `metaAutoSyncTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `catalog_sync_settings` ADD `metaAutoSyncEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `catalog_meta_auto_sync_task_idx` ON `catalog_sync_settings` (`metaAutoSyncTaskUid`);