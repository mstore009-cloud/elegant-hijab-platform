CREATE TABLE `stores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`primaryOwnerUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `stores_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `employee_profiles` ADD `storeId` int;--> statement-breakpoint
INSERT INTO `stores` (`name`, `slug`, `status`, `primaryOwnerUserId`)
VALUES (
  'عالم الحجابات الأنيقة',
  'elegant-hijab',
  'active',
  (SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `id` LIMIT 1)
);--> statement-breakpoint
UPDATE `employee_profiles`
SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1)
WHERE `storeId` IS NULL;--> statement-breakpoint
ALTER TABLE `employee_profiles` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_primaryOwnerUserId_users_id_fk` FOREIGN KEY (`primaryOwnerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `stores_status_idx` ON `stores` (`status`);--> statement-breakpoint
CREATE INDEX `stores_owner_idx` ON `stores` (`primaryOwnerUserId`);--> statement-breakpoint
ALTER TABLE `employee_profiles` ADD CONSTRAINT `employee_profiles_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;
