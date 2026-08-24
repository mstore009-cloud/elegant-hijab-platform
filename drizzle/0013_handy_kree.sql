CREATE TABLE `delivery_governorate_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`governorate` varchar(120) NOT NULL,
	`fee` decimal(12,2) NOT NULL DEFAULT '0.00',
	`enabled` boolean NOT NULL DEFAULT true,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `delivery_governorate_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_governorate_rates_governorate_unique` UNIQUE(`governorate`)
);
--> statement-breakpoint
ALTER TABLE `delivery_governorate_rates` ADD CONSTRAINT `delivery_governorate_rates_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `delivery_governorate_rates_enabled_idx` ON `delivery_governorate_rates` (`enabled`);