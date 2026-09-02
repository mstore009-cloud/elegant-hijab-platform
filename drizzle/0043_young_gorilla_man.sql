ALTER TABLE `meta_connections` ADD `authMode` enum('owner_direct','external_business') DEFAULT 'external_business' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD `authMode` enum('owner_direct','external_business') DEFAULT 'external_business' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD `encryptedSystemUserToken` text;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD `systemUserTokenStatus` enum('missing','ready','invalid','revoked') DEFAULT 'missing' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_connections` ADD `systemUserTokenLastTestedAt` timestamp;--> statement-breakpoint
ALTER TABLE `meta_oauth_states` ADD `authMode` enum('owner_direct','external_business') DEFAULT 'external_business' NOT NULL;
