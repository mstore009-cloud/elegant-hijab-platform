CREATE TABLE `meta_whatsapp_onboardings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`connectionId` int NOT NULL,
	`wabaId` varchar(255) NOT NULL,
	`phoneNumberId` varchar(255) NOT NULL,
	`displayPhoneNumber` varchar(64),
	`encryptedBusinessToken` text NOT NULL,
	`tokenExpiresAt` timestamp,
	`onboardingStatus` enum('connected','history_requested','history_receiving','history_completed','history_declined','offboarded','failed') NOT NULL DEFAULT 'connected',
	`coexistenceMode` enum('unknown','standard_cloud_api','coexistence') NOT NULL DEFAULT 'unknown',
	`historyRequestId` varchar(255),
	`contactsRequestId` varchar(255),
	`historyProgress` int NOT NULL DEFAULT 0,
	`historyPhase` int,
	`lastChunkOrder` int,
	`oldestMessageAt` timestamp,
	`newestMessageAt` timestamp,
	`onboardingCompletedAt` timestamp NOT NULL DEFAULT (now()),
	`historySyncDeadlineAt` timestamp NOT NULL,
	`lastHistoryWebhookAt` timestamp,
	`completedAt` timestamp,
	`lastError` varchar(500),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_whatsapp_onboardings_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_whatsapp_store_phone_unq` UNIQUE(`storeId`,`phoneNumberId`),
	CONSTRAINT `meta_whatsapp_phone_global_unq` UNIQUE(`phoneNumberId`)
);
--> statement-breakpoint
ALTER TABLE `meta_oauth_states` ADD `flowType` enum('meta_unified','whatsapp_embedded_signup') DEFAULT 'meta_unified' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_whatsapp_onboardings` ADD CONSTRAINT `meta_whatsapp_onboardings_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_whatsapp_onboardings` ADD CONSTRAINT `meta_whatsapp_onboardings_connectionId_meta_connections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `meta_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_whatsapp_onboardings` ADD CONSTRAINT `meta_whatsapp_onboardings_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_whatsapp_store_status_idx` ON `meta_whatsapp_onboardings` (`storeId`,`onboardingStatus`);--> statement-breakpoint
CREATE INDEX `meta_whatsapp_waba_idx` ON `meta_whatsapp_onboardings` (`wabaId`);