ALTER TABLE `customer_profiles` ADD `profileImageUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD `socialUsername` varchar(160);--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD `externalProfileId` varchar(255);--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD `profileMetadataJson` text;--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD `externalThreadId` varchar(255);--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD `nativeThreadUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD `contactAvatarUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD `contactUsername` varchar(160);--> statement-breakpoint
ALTER TABLE `inbox_conversations` ADD `contactProfileJson` text;