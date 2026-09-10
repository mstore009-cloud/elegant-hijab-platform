CREATE TABLE `ai_pricing_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('openai','gemini','anthropic') NOT NULL,
	`model` varchar(160) NOT NULL,
	`version` varchar(60) NOT NULL,
	`inputPerMillion` decimal(12,6) NOT NULL DEFAULT '0',
	`outputPerMillion` decimal(12,6) NOT NULL DEFAULT '0',
	`imagePerUnit` decimal(12,6) NOT NULL DEFAULT '0',
	`currency` varchar(12) NOT NULL DEFAULT 'USD',
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`effectiveTo` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_pricing_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_pricing_provider_model_version_unique` UNIQUE(`provider`,`model`,`version`)
);
--> statement-breakpoint
CREATE TABLE `ai_provider_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('openai','gemini','anthropic') NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`connectionType` enum('api_key','vertex_ai') NOT NULL DEFAULT 'api_key',
	`encryptedApiKey` text,
	`status` enum('disabled','untested','verified','needs_attention') NOT NULL DEFAULT 'untested',
	`enabled` boolean NOT NULL DEFAULT false,
	`lastTestedAt` timestamp,
	`lastError` varchar(500),
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_provider_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_provider_connection_name_unique` UNIQUE(`provider`,`displayName`)
);
--> statement-breakpoint
CREATE TABLE `ai_task_configurations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`task` enum('customer_reply_fast','customer_reply_escalation','product_image_analysis','customer_image_analysis','image_product_matching','marketing_analysis','content_generation') NOT NULL,
	`providerConnectionId` int,
	`model` varchar(160) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`maxTokens` int NOT NULL DEFAULT 1000,
	`timeoutMs` int NOT NULL DEFAULT 20000,
	`maxRetries` int NOT NULL DEFAULT 2,
	`fallbackEnabled` boolean NOT NULL DEFAULT false,
	`dailyQuota` int,
	`monthlyQuota` int,
	`monthlyBudget` decimal(12,6),
	`overLimitAction` enum('pause','draft_only','handoff') NOT NULL DEFAULT 'draft_only',
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_task_configurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_task_configuration_task_unique` UNIQUE(`task`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('openai','gemini','anthropic') NOT NULL,
	`providerConnectionId` int,
	`task` enum('customer_reply_fast','customer_reply_escalation','product_image_analysis','customer_image_analysis','image_product_matching','marketing_analysis','content_generation') NOT NULL,
	`model` varchar(160) NOT NULL,
	`storeId` int,
	`customerId` int,
	`conversationId` int,
	`inputTokens` int NOT NULL DEFAULT 0,
	`outputTokens` int NOT NULL DEFAULT 0,
	`imageUnits` int NOT NULL DEFAULT 0,
	`estimatedCost` decimal(12,6) NOT NULL DEFAULT '0',
	`currency` varchar(12) NOT NULL DEFAULT 'USD',
	`priceVersion` varchar(60),
	`providerRequestId` varchar(255),
	`status` enum('reserved','succeeded','failed','rejected_quota') NOT NULL,
	`errorCode` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_usage_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_pricing_cards` ADD CONSTRAINT `ai_pricing_cards_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_provider_connections` ADD CONSTRAINT `ai_provider_connections_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_task_configurations` ADD CONSTRAINT `ai_task_configurations_providerConnectionId_ai_provider_connections_id_fk` FOREIGN KEY (`providerConnectionId`) REFERENCES `ai_provider_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_task_configurations` ADD CONSTRAINT `ai_task_configurations_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `ai_usage_ledger_providerConnectionId_ai_provider_connections_id_fk` FOREIGN KEY (`providerConnectionId`) REFERENCES `ai_provider_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `ai_usage_ledger_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `ai_usage_ledger_customerId_customer_profiles_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customer_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_usage_ledger` ADD CONSTRAINT `ai_usage_ledger_conversationId_inbox_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_pricing_provider_model_idx` ON `ai_pricing_cards` (`provider`,`model`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `ai_provider_status_idx` ON `ai_provider_connections` (`provider`,`status`,`enabled`);--> statement-breakpoint
CREATE INDEX `ai_task_configuration_provider_idx` ON `ai_task_configurations` (`providerConnectionId`);--> statement-breakpoint
CREATE INDEX `ai_usage_provider_time_idx` ON `ai_usage_ledger` (`provider`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ai_usage_store_time_idx` ON `ai_usage_ledger` (`storeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ai_usage_task_time_idx` ON `ai_usage_ledger` (`task`,`createdAt`);