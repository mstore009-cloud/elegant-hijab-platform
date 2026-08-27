CREATE TABLE `employee_bot_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`fastModel` varchar(120) NOT NULL DEFAULT 'gpt-5-mini',
	`escalationModel` varchar(120) NOT NULL DEFAULT 'gpt-5',
	`minimumConfidence` int NOT NULL DEFAULT 80,
	`maxDailyCommands` int NOT NULL DEFAULT 80,
	`maxDailyEscalations` int NOT NULL DEFAULT 20,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_bot_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_bot_settings_store_unique` UNIQUE(`storeId`)
);
--> statement-breakpoint
CREATE TABLE `employee_bot_usage_counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`usageDate` varchar(10) NOT NULL,
	`fastCommandCount` int NOT NULL DEFAULT 0,
	`escalationCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_bot_usage_counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_bot_usage_store_date_unique` UNIQUE(`storeId`,`usageDate`)
);
--> statement-breakpoint
ALTER TABLE `employee_bot_settings` ADD CONSTRAINT `ebs_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_settings` ADD CONSTRAINT `ebs_updater_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_bot_usage_counters` ADD CONSTRAINT `ebuc_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_bot_settings_updater_idx` ON `employee_bot_settings` (`updatedByUserId`);
