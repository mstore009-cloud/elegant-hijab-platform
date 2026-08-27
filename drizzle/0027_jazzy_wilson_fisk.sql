CREATE TABLE `marketing_campaign_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`campaignId` int NOT NULL,
	`actorUserId` int,
	`action` enum('created','updated','content_linked','content_unlinked','budget_updated','approval_requested','approved','changes_requested','archived') NOT NULL,
	`note` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketing_campaign_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketing_campaign_budget_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text,
	`unitPrice` decimal(12,2) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketing_campaign_budget_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketing_campaign_content` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`contentPostId` int NOT NULL,
	`linkedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketing_campaign_content_id` PRIMARY KEY(`id`),
	CONSTRAINT `marketing_campaign_content_unique` UNIQUE(`campaignId`,`contentPostId`)
);
--> statement-breakpoint
CREATE TABLE `marketing_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`objective` enum('product_launch','reengagement','promotion','awareness','other') NOT NULL,
	`description` text,
	`status` enum('draft','needs_approval','approved','changes_requested','archived') NOT NULL DEFAULT 'draft',
	`audienceType` enum('all_customers','customer_tag','relationship_stage') NOT NULL DEFAULT 'all_customers',
	`audienceTagId` int,
	`audienceStage` enum('new','active','repeat','needs_followup','inactive'),
	`budgetAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`budgetCurrency` varchar(12) NOT NULL DEFAULT 'IQD',
	`approvalNote` text,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketing_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `marketing_campaign_activities` ADD CONSTRAINT `mkt_act_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_activities` ADD CONSTRAINT `mkt_act_campaign_fk` FOREIGN KEY (`campaignId`) REFERENCES `marketing_campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_activities` ADD CONSTRAINT `mkt_act_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_budget_items` ADD CONSTRAINT `mkt_budget_campaign_fk` FOREIGN KEY (`campaignId`) REFERENCES `marketing_campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_content` ADD CONSTRAINT `mkt_content_campaign_fk` FOREIGN KEY (`campaignId`) REFERENCES `marketing_campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_content` ADD CONSTRAINT `mkt_content_post_fk` FOREIGN KEY (`contentPostId`) REFERENCES `content_posts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaign_content` ADD CONSTRAINT `mkt_content_actor_fk` FOREIGN KEY (`linkedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD CONSTRAINT `mkt_campaign_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD CONSTRAINT `mkt_campaign_tag_fk` FOREIGN KEY (`audienceTagId`) REFERENCES `customer_tags`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD CONSTRAINT `mkt_campaign_approver_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_campaigns` ADD CONSTRAINT `mkt_campaign_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `marketing_activity_store_idx` ON `marketing_campaign_activities` (`storeId`);--> statement-breakpoint
CREATE INDEX `marketing_activity_campaign_time_idx` ON `marketing_campaign_activities` (`campaignId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `marketing_budget_campaign_idx` ON `marketing_campaign_budget_items` (`campaignId`);--> statement-breakpoint
CREATE INDEX `marketing_campaign_content_post_idx` ON `marketing_campaign_content` (`contentPostId`);--> statement-breakpoint
CREATE INDEX `marketing_campaign_store_status_idx` ON `marketing_campaigns` (`storeId`,`status`);--> statement-breakpoint
CREATE INDEX `marketing_campaign_store_created_idx` ON `marketing_campaigns` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `marketing_campaign_tag_idx` ON `marketing_campaigns` (`audienceTagId`);
