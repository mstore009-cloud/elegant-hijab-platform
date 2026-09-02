CREATE TABLE `meta_onboarding_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('draft','active','retired') NOT NULL DEFAULT 'draft',
	`businessLoginConfigurationId` varchar(255),
	`whatsappEmbeddedSignupConfigurationId` varchar(255),
	`defaultCapabilitiesJson` text NOT NULL,
	`readinessJson` text,
	`createdByUserId` int,
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_onboarding_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_onboarding_template_version_unq` UNIQUE(`version`)
);
--> statement-breakpoint
ALTER TABLE `meta_connections` ADD `templateVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_oauth_states` ADD `templateVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_platform_settings` ADD `publicBaseUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `meta_platform_settings` ADD `activeTemplateVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_onboarding_templates` ADD CONSTRAINT `meta_onboarding_templates_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `meta_onboarding_template_status_idx` ON `meta_onboarding_templates` (`status`);