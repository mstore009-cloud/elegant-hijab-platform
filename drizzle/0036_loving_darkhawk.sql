CREATE TABLE `meta_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`connectionId` int NOT NULL,
	`assetType` enum('business','page','instagram','whatsapp_business','whatsapp_phone','ad_account','dataset','pixel','catalog') NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`displayName` varchar(255),
	`parentExternalId` varchar(255),
	`metadataJson` text,
	`isSelected` boolean NOT NULL DEFAULT false,
	`lastDiscoveredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_asset_conn_type_ext_unq` UNIQUE(`connectionId`,`assetType`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `meta_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`purpose` enum('messaging','content','ads_read','leads','catalog','measurement') NOT NULL,
	`status` enum('connected','expired','revoked','failed','disabled') NOT NULL DEFAULT 'connected',
	`encryptedAccessToken` text,
	`tokenExpiresAt` timestamp,
	`grantedScopes` text NOT NULL,
	`metaUserId` varchar(255),
	`metaUserName` varchar(160),
	`configurationId` varchar(255),
	`connectedByUserId` int,
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`lastVerifiedAt` timestamp,
	`revokedAt` timestamp,
	`lastError` varchar(500),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_conn_store_purpose_unq` UNIQUE(`storeId`,`purpose`)
);
--> statement-breakpoint
CREATE TABLE `meta_oauth_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state` varchar(160) NOT NULL,
	`storeId` int NOT NULL,
	`userId` int NOT NULL,
	`purpose` enum('messaging','content','ads_read','leads','catalog','measurement') NOT NULL,
	`requestedScopes` text NOT NULL,
	`returnTo` varchar(255) NOT NULL DEFAULT '/meta-connections',
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meta_oauth_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_oauth_states_state_unique` UNIQUE(`state`)
);
--> statement-breakpoint
ALTER TABLE `channel_accounts` MODIFY COLUMN `channel` enum('whatsapp','instagram','messenger') NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_assets` ADD CONSTRAINT `meta_assets_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_assets` ADD CONSTRAINT `meta_assets_connectionId_meta_connections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `meta_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD CONSTRAINT `meta_connections_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD CONSTRAINT `meta_connections_connectedByUserId_users_id_fk` FOREIGN KEY (`connectedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_oauth_states` ADD CONSTRAINT `meta_oauth_states_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_oauth_states` ADD CONSTRAINT `meta_oauth_states_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_asset_store_type_sel_idx` ON `meta_assets` (`storeId`,`assetType`,`isSelected`);--> statement-breakpoint
CREATE INDEX `meta_conn_store_status_idx` ON `meta_connections` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `meta_state_store_user_idx` ON `meta_oauth_states` (`storeId`,`userId`);--> statement-breakpoint
CREATE INDEX `meta_state_expiry_idx` ON `meta_oauth_states` (`expiresAt`);