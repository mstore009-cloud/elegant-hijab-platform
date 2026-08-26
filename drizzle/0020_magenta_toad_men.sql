ALTER TABLE `delivery_governorate_rates` DROP INDEX `delivery_governorate_rates_governorate_unique`;--> statement-breakpoint
ALTER TABLE `promotion_coupons` DROP INDEX `promotion_coupons_code_unique`;--> statement-breakpoint
ALTER TABLE `delivery_governorate_rates` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `promotion_coupons` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `storeId` int;--> statement-breakpoint
UPDATE `delivery_governorate_rates` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `orders` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `promotion_coupons` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
UPDATE `store_settings` SET `storeId` = (SELECT `id` FROM `stores` WHERE `slug` = 'elegant-hijab' LIMIT 1) WHERE `storeId` IS NULL;--> statement-breakpoint
ALTER TABLE `delivery_governorate_rates` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `promotion_coupons` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` MODIFY COLUMN `storeId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_governorate_rates` ADD CONSTRAINT `delivery_store_governorate_unique` UNIQUE(`storeId`,`governorate`);--> statement-breakpoint
ALTER TABLE `promotion_coupons` ADD CONSTRAINT `promotion_coupon_store_code_unique` UNIQUE(`storeId`,`code`);--> statement-breakpoint
ALTER TABLE `store_settings` ADD CONSTRAINT `store_settings_store_unique` UNIQUE(`storeId`);--> statement-breakpoint
ALTER TABLE `delivery_governorate_rates` ADD CONSTRAINT `delivery_governorate_rates_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promotion_coupons` ADD CONSTRAINT `promotion_coupons_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `store_settings` ADD CONSTRAINT `store_settings_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `orders_store_created_idx` ON `orders` (`storeId`,`createdAt`);
