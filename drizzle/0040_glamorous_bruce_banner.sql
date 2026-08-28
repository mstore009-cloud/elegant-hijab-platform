CREATE TABLE `meta_webhook_retry_settings` (
	`id` int NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`enabled` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`lastResult` varchar(500),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_webhook_retry_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_retry_task_unique` UNIQUE(`scheduleCronTaskUid`)
);
