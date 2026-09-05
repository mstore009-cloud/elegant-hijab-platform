CREATE TABLE `onedrive_app_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`clientId` varchar(255) NOT NULL,
	`encryptedClientSecret` text NOT NULL,
	`authority` enum('consumers','organizations','common') NOT NULL DEFAULT 'consumers',
	`redirectUri` varchar(2048) NOT NULL,
	`status` enum('configured','verified','needs_attention') NOT NULL DEFAULT 'configured',
	`lastTestedAt` timestamp,
	`lastError` text,
	`createdByUserId` int NOT NULL,
	`updatedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onedrive_app_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `onedrive_app_config_store_unique` UNIQUE(`storeId`)
);
--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD `appConfigId` int;--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD `appConfigId` int;--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD `appConfigId` int;--> statement-breakpoint
ALTER TABLE `onedrive_app_configs` ADD CONSTRAINT `onedrive_app_configs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_app_configs` ADD CONSTRAINT `onedrive_app_configs_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_app_configs` ADD CONSTRAINT `onedrive_app_configs_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `onedrive_app_config_status_idx` ON `onedrive_app_configs` (`status`);--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD CONSTRAINT `od_catalog_config_fk` FOREIGN KEY (`appConfigId`) REFERENCES `onedrive_app_configs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD CONSTRAINT `od_connection_config_fk` FOREIGN KEY (`appConfigId`) REFERENCES `onedrive_app_configs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD CONSTRAINT `od_state_config_fk` FOREIGN KEY (`appConfigId`) REFERENCES `onedrive_app_configs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `onedrive_catalog_connection_config_idx` ON `onedrive_catalog_connections` (`appConfigId`);--> statement-breakpoint
CREATE INDEX `onedrive_connection_config_idx` ON `onedrive_connections` (`appConfigId`);--> statement-breakpoint
CREATE INDEX `onedrive_oauth_state_config_idx` ON `onedrive_oauth_states` (`appConfigId`);
