ALTER TABLE `channel_accounts` ADD `appSubscriptionStatus` enum('unknown','ready','error') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_accounts` ADD `assetSubscriptionStatus` enum('unknown','ready','error') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_accounts` ADD `subscriptionLastCheckedAt` timestamp;