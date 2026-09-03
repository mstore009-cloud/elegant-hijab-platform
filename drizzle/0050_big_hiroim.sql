ALTER TABLE `customer_bot_runs` MODIFY COLUMN `status` enum('draft','handoff','failed','dismissed','replied') NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `messengerEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `instagramEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `whatsappEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `dialect` varchar(80) DEFAULT 'عراقي' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `tone` enum('warm','professional','concise') DEFAULT 'warm' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `operatorInstructions` text;