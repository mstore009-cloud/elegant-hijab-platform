CREATE TABLE `loyalty_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`programId` int NOT NULL,
	`membershipId` int,
	`rewardId` int,
	`ledgerEntryId` int,
	`type` enum('program_created','program_status_changed','tier_created','membership_joined','membership_status_changed','tier_assigned','points_recorded','reward_created','reward_approval_requested','reward_approved','reward_archived') NOT NULL,
	`note` text,
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`programId` int NOT NULL,
	`customerId` int NOT NULL,
	`currentTierId` int,
	`pointsBalance` int NOT NULL DEFAULT 0,
	`status` enum('active','paused','removed') NOT NULL DEFAULT 'active',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`createdByUserId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_membership_program_customer_unique` UNIQUE(`programId`,`customerId`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_point_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`programId` int NOT NULL,
	`membershipId` int NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`pointsDelta` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`reason` enum('manual_award','manual_deduction','correction') NOT NULL,
	`note` text NOT NULL,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_point_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_programs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`pointsLabel` varchar(80) NOT NULL DEFAULT 'نقطة',
	`status` enum('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
	`description` text,
	`createdByUserId` int NOT NULL,
	`activatedByUserId` int,
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_programs_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_program_store_unique` UNIQUE(`storeId`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`programId` int NOT NULL,
	`membershipId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`status` enum('draft','needs_approval','approved','archived') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`decisionNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_tiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`programId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`rank` int NOT NULL,
	`thresholdPoints` int NOT NULL DEFAULT 0,
	`benefitsSummary` text,
	`isBase` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_tiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `loyalty_tier_program_rank_unique` UNIQUE(`programId`,`rank`),
	CONSTRAINT `loyalty_tier_program_name_unique` UNIQUE(`programId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_programId_loyalty_programs_id_fk` FOREIGN KEY (`programId`) REFERENCES `loyalty_programs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_membershipId_loyalty_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `loyalty_memberships`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_rewardId_loyalty_rewards_id_fk` FOREIGN KEY (`rewardId`) REFERENCES `loyalty_rewards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_ledgerEntryId_loyalty_point_ledger_id_fk` FOREIGN KEY (`ledgerEntryId`) REFERENCES `loyalty_point_ledger`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_activities` ADD CONSTRAINT `loyalty_activities_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_memberships` ADD CONSTRAINT `loyalty_memberships_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_memberships` ADD CONSTRAINT `loyalty_memberships_programId_loyalty_programs_id_fk` FOREIGN KEY (`programId`) REFERENCES `loyalty_programs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_memberships` ADD CONSTRAINT `loyalty_memberships_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_memberships` ADD CONSTRAINT `loyalty_memberships_currentTierId_loyalty_tiers_id_fk` FOREIGN KEY (`currentTierId`) REFERENCES `loyalty_tiers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_memberships` ADD CONSTRAINT `loyalty_memberships_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_point_ledger` ADD CONSTRAINT `loyalty_point_ledger_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_point_ledger` ADD CONSTRAINT `loyalty_point_ledger_programId_loyalty_programs_id_fk` FOREIGN KEY (`programId`) REFERENCES `loyalty_programs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_point_ledger` ADD CONSTRAINT `loyalty_point_ledger_membershipId_loyalty_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `loyalty_memberships`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_point_ledger` ADD CONSTRAINT `loyalty_point_ledger_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_programs` ADD CONSTRAINT `loyalty_programs_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_programs` ADD CONSTRAINT `loyalty_programs_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_programs` ADD CONSTRAINT `loyalty_programs_activatedByUserId_users_id_fk` FOREIGN KEY (`activatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_programId_loyalty_programs_id_fk` FOREIGN KEY (`programId`) REFERENCES `loyalty_programs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_membershipId_loyalty_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `loyalty_memberships`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_rewards` ADD CONSTRAINT `loyalty_rewards_approvedByUserId_users_id_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loyalty_tiers` ADD CONSTRAINT `loyalty_tiers_programId_loyalty_programs_id_fk` FOREIGN KEY (`programId`) REFERENCES `loyalty_programs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `loyalty_activity_store_time_idx` ON `loyalty_activities` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loyalty_activity_program_time_idx` ON `loyalty_activities` (`programId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loyalty_activity_membership_idx` ON `loyalty_activities` (`membershipId`);--> statement-breakpoint
CREATE INDEX `loyalty_membership_store_status_idx` ON `loyalty_memberships` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `loyalty_membership_customer_idx` ON `loyalty_memberships` (`customerId`);--> statement-breakpoint
CREATE INDEX `loyalty_ledger_store_time_idx` ON `loyalty_point_ledger` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loyalty_ledger_membership_time_idx` ON `loyalty_point_ledger` (`membershipId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loyalty_program_store_status_idx` ON `loyalty_programs` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `loyalty_reward_store_status_idx` ON `loyalty_rewards` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `loyalty_reward_membership_idx` ON `loyalty_rewards` (`membershipId`);--> statement-breakpoint
CREATE INDEX `loyalty_tier_program_idx` ON `loyalty_tiers` (`programId`);