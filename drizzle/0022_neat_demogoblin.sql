CREATE TABLE `customer_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`customerId` int NOT NULL,
	`type` enum('profile_created','profile_updated','order_created','order_status_changed','note','tag_added','tag_removed','task_created','task_completed','inbox_message') NOT NULL,
	`title` varchar(240) NOT NULL,
	`body` text,
	`actorUserId` int,
	`orderId` int,
	`taskId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`phoneNormalized` varchar(40) NOT NULL,
	`phoneDisplay` varchar(40) NOT NULL,
	`governorate` varchar(120),
	`lastAddress` text,
	`relationshipStage` enum('new','active','repeat','needs_followup','inactive') NOT NULL DEFAULT 'new',
	`firstChannel` enum('storefront','whatsapp','instagram','messenger','manual') NOT NULL DEFAULT 'storefront',
	`lastChannel` enum('storefront','whatsapp','instagram','messenger','manual') NOT NULL DEFAULT 'storefront',
	`firstOrderAt` timestamp,
	`lastOrderAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_store_phone_unique` UNIQUE(`storeId`,`phoneNormalized`)
);
--> statement-breakpoint
CREATE TABLE `customer_tag_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customerId` int NOT NULL,
	`tagId` int NOT NULL,
	`assignedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_tag_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_tag_assignment_unique` UNIQUE(`customerId`,`tagId`)
);
--> statement-breakpoint
CREATE TABLE `customer_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`color` varchar(24) NOT NULL DEFAULT 'slate',
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_tag_store_name_unique` UNIQUE(`storeId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `customer_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`customerId` int NOT NULL,
	`title` varchar(220) NOT NULL,
	`note` text,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`dueAt` timestamp,
	`assigneeEmployeeId` int,
	`createdByUserId` int NOT NULL,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customerId` int;--> statement-breakpoint
ALTER TABLE `customer_activities` ADD CONSTRAINT `customer_activities_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_activities` ADD CONSTRAINT `customer_activities_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_activities` ADD CONSTRAINT `customer_activities_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD CONSTRAINT `customer_profiles_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tag_assignments` ADD CONSTRAINT `customer_tag_assignments_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tag_assignments` ADD CONSTRAINT `customer_tag_assignments_tagId_customer_tags_id_fk` FOREIGN KEY (`tagId`) REFERENCES `customer_tags`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tag_assignments` ADD CONSTRAINT `customer_tag_assignments_assignedByUserId_users_id_fk` FOREIGN KEY (`assignedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tags` ADD CONSTRAINT `customer_tags_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tags` ADD CONSTRAINT `customer_tags_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tasks` ADD CONSTRAINT `customer_tasks_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tasks` ADD CONSTRAINT `customer_tasks_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tasks` ADD CONSTRAINT `customer_tasks_assigneeEmployeeId_employee_profiles_id_fk` FOREIGN KEY (`assigneeEmployeeId`) REFERENCES `employee_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_tasks` ADD CONSTRAINT `customer_tasks_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO `customer_profiles` (`storeId`, `displayName`, `phoneNormalized`, `phoneDisplay`, `governorate`, `lastAddress`, `relationshipStage`, `firstChannel`, `lastChannel`, `firstOrderAt`, `lastOrderAt`)
SELECT
	`legacy_orders`.`storeId`,
	COALESCE(SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(`customerName`), '') ORDER BY `createdAt` DESC, `id` DESC SEPARATOR '|'), '|', 1), CONCAT('عميل سابق ', MIN(`id`))),
	`legacy_orders`.`phoneNormalized`,
	COALESCE(SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(`customerPhone`), '') ORDER BY `createdAt` DESC, `id` DESC SEPARATOR '|'), '|', 1), CONCAT('legacy-', `legacy_orders`.`storeId`, '-', MIN(`id`))),
	SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(`governorate`), '') ORDER BY `createdAt` DESC, `id` DESC SEPARATOR '|'), '|', 1),
	SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(TRIM(`address`), '') ORDER BY `createdAt` DESC, `id` DESC SEPARATOR '|'), '|', 1),
	CASE WHEN COUNT(*) > 1 THEN 'repeat' ELSE 'active' END,
	SUBSTRING_INDEX(GROUP_CONCAT(`customerChannel` ORDER BY `createdAt` ASC, `id` ASC SEPARATOR ','), ',', 1),
	SUBSTRING_INDEX(GROUP_CONCAT(`customerChannel` ORDER BY `createdAt` DESC, `id` DESC SEPARATOR ','), ',', 1),
	MIN(`createdAt`),
	MAX(`createdAt`)
FROM (
	SELECT `orders`.*, CASE
		WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(`customerPhone`), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') = '' THEN CONCAT('legacy-', `storeId`, '-', `id`)
		ELSE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(`customerPhone`), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')
	END AS `phoneNormalized`
	FROM `orders`
) AS `legacy_orders`
GROUP BY `legacy_orders`.`storeId`, `legacy_orders`.`phoneNormalized`;--> statement-breakpoint
UPDATE `orders` AS `o`
INNER JOIN `customer_profiles` AS `c`
	ON `c`.`storeId` = `o`.`storeId`
	AND `c`.`phoneNormalized` = CASE
		WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(`o`.`customerPhone`), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') = '' THEN CONCAT('legacy-', `o`.`storeId`, '-', `o`.`id`)
		ELSE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(`o`.`customerPhone`), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')
	END
SET `o`.`customerId` = `c`.`id`;--> statement-breakpoint
CREATE INDEX `customer_activity_store_customer_idx` ON `customer_activities` (`storeId`,`customerId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `customer_activity_order_idx` ON `customer_activities` (`orderId`);--> statement-breakpoint
CREATE INDEX `customer_activity_task_idx` ON `customer_activities` (`taskId`);--> statement-breakpoint
CREATE INDEX `customer_store_stage_idx` ON `customer_profiles` (`storeId`,`relationshipStage`);--> statement-breakpoint
CREATE INDEX `customer_store_last_order_idx` ON `customer_profiles` (`storeId`,`lastOrderAt`);--> statement-breakpoint
CREATE INDEX `customer_tag_assignment_customer_idx` ON `customer_tag_assignments` (`customerId`);--> statement-breakpoint
CREATE INDEX `customer_tag_assignment_tag_idx` ON `customer_tag_assignments` (`tagId`);--> statement-breakpoint
CREATE INDEX `customer_tag_store_idx` ON `customer_tags` (`storeId`);--> statement-breakpoint
CREATE INDEX `customer_task_store_status_idx` ON `customer_tasks` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `customer_task_customer_idx` ON `customer_tasks` (`customerId`);--> statement-breakpoint
CREATE INDEX `customer_task_assignee_idx` ON `customer_tasks` (`assigneeEmployeeId`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customerId`);
