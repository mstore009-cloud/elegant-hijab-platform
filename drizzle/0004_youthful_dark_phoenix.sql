CREATE TABLE `onedrive_catalog_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`encryptedAccessToken` text NOT NULL,
	`encryptedRefreshToken` text NOT NULL,
	`accessTokenExpiresAt` timestamp NOT NULL,
	`scope` text NOT NULL,
	`status` enum('connected','failed','catalog_selected') NOT NULL DEFAULT 'connected',
	`lastError` text,
	`selectedDriveId` varchar(255),
	`selectedFolderId` varchar(255),
	`selectedFolderName` varchar(255),
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onedrive_catalog_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `onedrive_catalog_connections_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD `flow` enum('app_folder','catalog_read') DEFAULT 'app_folder' NOT NULL;--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD CONSTRAINT `onedrive_catalog_connections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `onedrive_catalog_connection_status_idx` ON `onedrive_catalog_connections` (`status`);