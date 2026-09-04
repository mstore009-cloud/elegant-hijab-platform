CREATE TABLE `meta_lead_captures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`metaAssetId` int,
	`externalLeadId` varchar(255) NOT NULL,
	`formId` varchar(255),
	`adId` varchar(255),
	`fieldDataJson` text,
	`consentStatus` enum('unknown','granted','denied') NOT NULL DEFAULT 'unknown',
	`status` enum('pending','imported','failed','ignored') NOT NULL DEFAULT 'pending',
	`customerId` int,
	`lastError` varchar(500),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`importedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_lead_captures_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_lead_store_external_unique` UNIQUE(`storeId`,`externalLeadId`)
);
--> statement-breakpoint
ALTER TABLE `meta_lead_captures` ADD CONSTRAINT `meta_lead_captures_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_lead_captures` ADD CONSTRAINT `meta_lead_captures_metaAssetId_meta_assets_id_fk` FOREIGN KEY (`metaAssetId`) REFERENCES `meta_assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meta_lead_captures` ADD CONSTRAINT `meta_lead_captures_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_lead_store_status_idx` ON `meta_lead_captures` (`storeId`,`status`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `meta_lead_customer_idx` ON `meta_lead_captures` (`customerId`);