ALTER TABLE `customer_bot_runs` ADD `actionDecisionJson` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `welcomeTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `priceReplyTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `colorOfferTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `productCardTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `orderSummaryTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `confirmationTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `humanWaitingTemplate` text;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `productResponseMode` enum('smart','images','product_card','ask_first') DEFAULT 'smart' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `learningEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_bot_settings` ADD `learningReviewDays` int DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD `mediaUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `meta_outbound_messages` ADD `mediaType` enum('image','video','document');