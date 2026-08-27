CREATE TABLE `customer_bot_knowledge_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`title` varchar(240) NOT NULL,
	`kind` enum('faq','policy','style_guidance','product_guidance') NOT NULL DEFAULT 'faq',
	`body` text NOT NULL,
	`status` enum('draft','approved','archived') NOT NULL DEFAULT 'draft',
	`source` enum('manual','review_feedback','historical_candidate') NOT NULL DEFAULT 'manual',
	`createdByUserId` int NOT NULL,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_knowledge_articles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_knowledge_gaps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`runId` int,
	`category` enum('knowledge','policy','handoff','experience','action') NOT NULL DEFAULT 'knowledge',
	`title` varchar(240) NOT NULL,
	`questionSnapshot` text,
	`status` enum('open','resolved','dismissed') NOT NULL DEFAULT 'open',
	`resolutionNote` text,
	`createdByUserId` int NOT NULL,
	`resolvedByUserId` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_knowledge_gaps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_run_knowledge_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`runId` int NOT NULL,
	`knowledgeArticleId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_bot_run_knowledge_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_run_knowledge_unique` UNIQUE(`runId`,`knowledgeArticleId`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_run_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`runId` int NOT NULL,
	`outcome` enum('approved_as_is','approved_edited','rejected','human_handoff','knowledge_gap') NOT NULL,
	`finalReply` text,
	`feedback` text,
	`reviewedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_run_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_run_review_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_articles` ADD CONSTRAINT `c_bka_store` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_articles` ADD CONSTRAINT `c_bka_created` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_articles` ADD CONSTRAINT `c_bka_approved` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_gaps` ADD CONSTRAINT `c_bkg_store` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_gaps` ADD CONSTRAINT `c_bkg_run` FOREIGN KEY (`runId`) REFERENCES `customer_bot_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_gaps` ADD CONSTRAINT `c_bkg_created` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_knowledge_gaps` ADD CONSTRAINT `c_bkg_resolved` FOREIGN KEY (`resolvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_knowledge_sources` ADD CONSTRAINT `c_brks_store` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_knowledge_sources` ADD CONSTRAINT `c_brks_run` FOREIGN KEY (`runId`) REFERENCES `customer_bot_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_knowledge_sources` ADD CONSTRAINT `c_brks_article` FOREIGN KEY (`knowledgeArticleId`) REFERENCES `customer_bot_knowledge_articles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_reviews` ADD CONSTRAINT `c_brr_store` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_reviews` ADD CONSTRAINT `c_brr_run` FOREIGN KEY (`runId`) REFERENCES `customer_bot_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_run_reviews` ADD CONSTRAINT `c_brr_reviewer` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bot_knowledge_store_status_time` ON `customer_bot_knowledge_articles` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_knowledge_store_kind_time` ON `customer_bot_knowledge_articles` (`storeId`,`kind`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_gap_store_status_time` ON `customer_bot_knowledge_gaps` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_gap_store_run_idx` ON `customer_bot_knowledge_gaps` (`storeId`,`runId`);--> statement-breakpoint
CREATE INDEX `bot_knowledge_source_store_run` ON `customer_bot_run_knowledge_sources` (`storeId`,`runId`);--> statement-breakpoint
CREATE INDEX `bot_review_store_outcome_time` ON `customer_bot_run_reviews` (`storeId`,`outcome`,`updatedAt`);
