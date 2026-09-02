CREATE TABLE `meta_connection_capabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`connectionId` int NOT NULL,
	`purpose` enum('messaging','content','ads_read','leads','catalog','measurement') NOT NULL,
	`status` enum('ready','missing_scope','missing_asset','disabled','needs_setup') NOT NULL DEFAULT 'needs_setup',
	`enabled` boolean NOT NULL DEFAULT false,
	`requiredScopes` text NOT NULL,
	`missingScopes` text,
	`lastVerifiedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_connection_capabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_capability_conn_purpose_unq` UNIQUE(`connectionId`,`purpose`)
);
--> statement-breakpoint
CREATE TABLE `meta_platform_settings` (
	`id` int NOT NULL,
	`appId` varchar(80),
	`encryptedAppSecret` text,
	`businessLoginConfigurationId` varchar(255),
	`whatsappEmbeddedSignupConfigurationId` varchar(255),
	`encryptedWebhookVerifyToken` text,
	`graphApiVersion` varchar(16) NOT NULL DEFAULT 'v26.0',
	`status` enum('incomplete','ready','verified','needs_attention') NOT NULL DEFAULT 'incomplete',
	`lastTestedAt` timestamp,
	`lastError` varchar(500),
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_platform_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `meta_connections` MODIFY COLUMN `purpose` enum('unified','messaging','content','ads_read','leads','catalog','measurement') NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_oauth_states` MODIFY COLUMN `purpose` enum('unified','messaging','content','ads_read','leads','catalog','measurement') NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_connection_capabilities` ADD CONSTRAINT `meta_connection_capabilities_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_connection_capabilities` ADD CONSTRAINT `meta_connection_capabilities_connectionId_meta_connections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `meta_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_platform_settings` ADD CONSTRAINT `meta_platform_settings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_capability_store_status_idx` ON `meta_connection_capabilities` (`storeId`,`status`);