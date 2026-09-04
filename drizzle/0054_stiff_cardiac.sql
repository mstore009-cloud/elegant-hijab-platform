CREATE TABLE `catalog_group_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`ownerUserId` int NOT NULL,
	`groupFolderId` varchar(255) NOT NULL,
	`groupName` varchar(120) NOT NULL,
	`sourceReference` varchar(512) NOT NULL,
	`state` enum('discovered','needs_review','missing') NOT NULL,
	`lastError` text,
	`lastScannedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_group_imports_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_group_store_unique` UNIQUE(`storeId`,`groupFolderId`)
);
--> statement-breakpoint
ALTER TABLE `catalog_group_imports` ADD CONSTRAINT `catalog_group_imports_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_group_imports` ADD CONSTRAINT `catalog_group_imports_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `catalog_group_owner_idx` ON `catalog_group_imports` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `catalog_group_state_idx` ON `catalog_group_imports` (`storeId`,`state`);