CREATE TABLE `employee_permission_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`permissionCode` varchar(96) NOT NULL,
	`grantedByUserId` int,
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_permission_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_permission_unique` UNIQUE(`employeeId`,`permissionCode`)
);
--> statement-breakpoint
CREATE TABLE `employee_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`jobTitle` varchar(160),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_profiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `employee_permission_grants` ADD CONSTRAINT `employee_permission_grants_employeeId_employee_profiles_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employee_profiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_permission_grants` ADD CONSTRAINT `employee_permission_grants_grantedByUserId_users_id_fk` FOREIGN KEY (`grantedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_profiles` ADD CONSTRAINT `employee_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `permission_code_idx` ON `employee_permission_grants` (`permissionCode`);