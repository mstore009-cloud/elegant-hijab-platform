CREATE TABLE `onedrive_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`encryptedAccessToken` text NOT NULL,
	`encryptedRefreshToken` text NOT NULL,
	`accessTokenExpiresAt` timestamp NOT NULL,
	`appFolderId` varchar(255) NOT NULL,
	`appFolderUrl` text,
	`scope` text,
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onedrive_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `onedrive_connections_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `onedrive_oauth_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state` varchar(160) NOT NULL,
	`userId` int NOT NULL,
	`codeVerifier` varchar(160) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onedrive_oauth_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `onedrive_oauth_states_state_unique` UNIQUE(`state`)
);
--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD CONSTRAINT `onedrive_connections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD CONSTRAINT `onedrive_oauth_states_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `onedrive_connection_folder_idx` ON `onedrive_connections` (`appFolderId`);--> statement-breakpoint
CREATE INDEX `onedrive_oauth_state_user_idx` ON `onedrive_oauth_states` (`userId`);