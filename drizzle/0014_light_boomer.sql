CREATE TABLE `promotion_coupons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(80) NOT NULL,
	`discountType` enum('fixed','percent') NOT NULL,
	`discountValue` decimal(12,2) NOT NULL,
	`minimumSubtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`startsAt` timestamp,
	`endsAt` timestamp,
	`usageLimit` int,
	`usageCount` int NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promotion_coupons_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotion_coupons_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`defaultLanguage` varchar(16) NOT NULL DEFAULT 'ar',
	`currencyCode` varchar(8) NOT NULL DEFAULT 'IQD',
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `store_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `promotion_coupons` ADD CONSTRAINT `promotion_coupons_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `store_settings` ADD CONSTRAINT `store_settings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `promotion_coupons_enabled_idx` ON `promotion_coupons` (`enabled`);