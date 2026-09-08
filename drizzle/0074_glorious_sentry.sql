ALTER TABLE `product_categories` ADD `displayName` varchar(180);--> statement-breakpoint
ALTER TABLE `products` ADD `categoryAssignmentSource` enum('onedrive','manual') DEFAULT 'onedrive' NOT NULL;--> statement-breakpoint
UPDATE `products` AS p
INNER JOIN `product_categories` AS c ON c.`storeId` = p.`storeId` AND c.`sourcePath` = CONCAT('Catalog/', p.`category`)
SET p.`categoryId` = c.`id`
WHERE p.`categoryId` IS NULL AND p.`category` IS NOT NULL;
