ALTER TABLE `store_settings` ADD `freeDeliveryEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `freeDeliveryThreshold` decimal(12,2);