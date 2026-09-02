CREATE TABLE `meta_whatsapp_history_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`onboardingId` int NOT NULL,
	`phase` int NOT NULL,
	`chunkOrder` int NOT NULL,
	`progress` int NOT NULL DEFAULT 0,
	`payloadHash` varchar(64) NOT NULL,
	`payloadJson` text,
	`status` enum('pending','processing','retry_pending','processed','dead_letter') NOT NULL DEFAULT 'pending',
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lastError` varchar(500),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `meta_whatsapp_history_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_whatsapp_history_chunk_unq` UNIQUE(`onboardingId`,`phase`,`chunkOrder`)
);
--> statement-breakpoint
ALTER TABLE `meta_whatsapp_history_chunks` ADD CONSTRAINT `meta_wh_hist_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_whatsapp_history_chunks` ADD CONSTRAINT `meta_wh_hist_onboarding_fk` FOREIGN KEY (`onboardingId`) REFERENCES `meta_whatsapp_onboardings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_whatsapp_history_store_status_idx` ON `meta_whatsapp_history_chunks` (`storeId`,`status`,`nextAttemptAt`);
