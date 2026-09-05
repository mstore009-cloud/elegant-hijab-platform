CREATE INDEX `onedrive_catalog_connection_user_idx` ON `onedrive_catalog_connections` (`userId`);--> statement-breakpoint
CREATE INDEX `onedrive_connection_user_idx` ON `onedrive_connections` (`userId`);--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` DROP INDEX `onedrive_catalog_connections_userId_unique`;--> statement-breakpoint
ALTER TABLE `onedrive_connections` DROP INDEX `onedrive_connections_userId_unique`;--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD `storeId` int;--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD `storeId` int;--> statement-breakpoint
UPDATE `onedrive_catalog_connections` AS connection_row
INNER JOIN (
  SELECT `primaryOwnerUserId`, MIN(`id`) AS `storeId`
  FROM `stores`
  WHERE `primaryOwnerUserId` IS NOT NULL
  GROUP BY `primaryOwnerUserId`
) AS owner_store ON owner_store.`primaryOwnerUserId` = connection_row.`userId`
SET connection_row.`storeId` = owner_store.`storeId`
WHERE connection_row.`storeId` IS NULL;--> statement-breakpoint
UPDATE `onedrive_connections` AS connection_row
INNER JOIN (
  SELECT `primaryOwnerUserId`, MIN(`id`) AS `storeId`
  FROM `stores`
  WHERE `primaryOwnerUserId` IS NOT NULL
  GROUP BY `primaryOwnerUserId`
) AS owner_store ON owner_store.`primaryOwnerUserId` = connection_row.`userId`
SET connection_row.`storeId` = owner_store.`storeId`
WHERE connection_row.`storeId` IS NULL;--> statement-breakpoint
UPDATE `onedrive_oauth_states` AS oauth_state
INNER JOIN (
  SELECT `primaryOwnerUserId`, MIN(`id`) AS `storeId`
  FROM `stores`
  WHERE `primaryOwnerUserId` IS NOT NULL
  GROUP BY `primaryOwnerUserId`
) AS owner_store ON owner_store.`primaryOwnerUserId` = oauth_state.`userId`
SET oauth_state.`storeId` = owner_store.`storeId`
WHERE oauth_state.`storeId` IS NULL;--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD CONSTRAINT `onedrive_catalog_connection_store_unique` UNIQUE(`storeId`);--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD CONSTRAINT `onedrive_connection_store_unique` UNIQUE(`storeId`);--> statement-breakpoint
ALTER TABLE `onedrive_catalog_connections` ADD CONSTRAINT `onedrive_catalog_connections_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_connections` ADD CONSTRAINT `onedrive_connections_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onedrive_oauth_states` ADD CONSTRAINT `onedrive_oauth_states_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `onedrive_oauth_state_store_idx` ON `onedrive_oauth_states` (`storeId`); 
