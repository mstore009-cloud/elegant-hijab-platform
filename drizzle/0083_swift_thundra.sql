CREATE TABLE `customer_bot_behavior_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`title` varchar(240) NOT NULL,
	`kind` enum('welcome','dialect','tone','reply_example','guardrail') NOT NULL,
	`body` text NOT NULL,
	`examplesJson` text,
	`channelsJson` text,
	`priority` int NOT NULL DEFAULT 50,
	`status` enum('draft','approved','archived') NOT NULL DEFAULT 'draft',
	`sourceProposalId` int,
	`createdByUserId` int NOT NULL,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_behavior_cards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_command_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`createdByUserId` int NOT NULL,
	`inputType` enum('text','audio') NOT NULL,
	`originalText` text,
	`storageKey` varchar(512),
	`transcript` text,
	`classificationJson` text,
	`proposedChangeJson` text,
	`status` enum('transcribed','needs_clarification','previewed','saved_draft','cancelled','failed') NOT NULL DEFAULT 'previewed',
	`errorSummary` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_command_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_learning_proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`sessionId` int,
	`sourceMessageId` int,
	`category` enum('dialect_style','reply_example','knowledge','sales_playbook','test_case','guardrail','knowledge_gap') NOT NULL,
	`originalReply` text,
	`editedReply` text,
	`title` varchar(240) NOT NULL,
	`body` text NOT NULL,
	`aiClassificationJson` text,
	`status` enum('draft','approved','rejected','archived') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`reviewedByUserId` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_learning_proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_playbooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`title` varchar(240) NOT NULL,
	`triggerJson` text NOT NULL,
	`stepsJson` text NOT NULL,
	`guardrailsJson` text,
	`status` enum('draft','approved','archived') NOT NULL DEFAULT 'draft',
	`sourceProposalId` int,
	`createdByUserId` int NOT NULL,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_playbooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_playground_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`sessionId` int NOT NULL,
	`role` enum('customer','assistant','system') NOT NULL,
	`body` text NOT NULL,
	`actionJson` text,
	`confidence` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_bot_playground_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_playground_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`createdByUserId` int NOT NULL,
	`mode` enum('live_read_only','conversation_context','new_test_customer','existing_customer_read_only','order_simulation') NOT NULL DEFAULT 'live_read_only',
	`channel` enum('whatsapp','instagram','messenger','internal') NOT NULL DEFAULT 'internal',
	`conversationId` int,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `customer_bot_playground_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bot_test_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`title` varchar(240) NOT NULL,
	`inputJson` text NOT NULL,
	`expectedJson` text,
	`status` enum('draft','approved','archived') NOT NULL DEFAULT 'draft',
	`sourceProposalId` int,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bot_test_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `customer_bot_behavior_cards` ADD CONSTRAINT `cb_bc_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_behavior_cards` ADD CONSTRAINT `cb_bc_proposal_fk` FOREIGN KEY (`sourceProposalId`) REFERENCES `customer_bot_learning_proposals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_behavior_cards` ADD CONSTRAINT `cb_bc_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_behavior_cards` ADD CONSTRAINT `cb_bc_approver_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_command_requests` ADD CONSTRAINT `cb_cmd_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_command_requests` ADD CONSTRAINT `cb_cmd_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_learning_proposals` ADD CONSTRAINT `cb_lp_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_learning_proposals` ADD CONSTRAINT `cb_lp_session_fk` FOREIGN KEY (`sessionId`) REFERENCES `customer_bot_playground_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_learning_proposals` ADD CONSTRAINT `cb_lp_message_fk` FOREIGN KEY (`sourceMessageId`) REFERENCES `customer_bot_playground_messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_learning_proposals` ADD CONSTRAINT `cb_lp_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_learning_proposals` ADD CONSTRAINT `cb_lp_reviewer_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playbooks` ADD CONSTRAINT `cb_pb_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playbooks` ADD CONSTRAINT `cb_pb_proposal_fk` FOREIGN KEY (`sourceProposalId`) REFERENCES `customer_bot_learning_proposals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playbooks` ADD CONSTRAINT `cb_pb_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playbooks` ADD CONSTRAINT `cb_pb_approver_fk` FOREIGN KEY (`approvedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playground_messages` ADD CONSTRAINT `cb_pm_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playground_messages` ADD CONSTRAINT `cb_pm_session_fk` FOREIGN KEY (`sessionId`) REFERENCES `customer_bot_playground_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playground_sessions` ADD CONSTRAINT `cb_ps_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playground_sessions` ADD CONSTRAINT `cb_ps_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_playground_sessions` ADD CONSTRAINT `cb_ps_conversation_fk` FOREIGN KEY (`conversationId`) REFERENCES `inbox_conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_test_cases` ADD CONSTRAINT `cb_tc_store_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_test_cases` ADD CONSTRAINT `cb_tc_proposal_fk` FOREIGN KEY (`sourceProposalId`) REFERENCES `customer_bot_learning_proposals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_bot_test_cases` ADD CONSTRAINT `cb_tc_creator_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bot_behavior_store_status_priority` ON `customer_bot_behavior_cards` (`storeId`,`status`,`priority`);--> statement-breakpoint
CREATE INDEX `bot_command_store_status_time` ON `customer_bot_command_requests` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_learning_proposal_store_status_idx` ON `customer_bot_learning_proposals` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_playbook_store_status_idx` ON `customer_bot_playbooks` (`storeId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `bot_playground_message_session_idx` ON `customer_bot_playground_messages` (`storeId`,`sessionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bot_playground_store_status_time` ON `customer_bot_playground_sessions` (`storeId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bot_test_case_store_status_idx` ON `customer_bot_test_cases` (`storeId`,`status`,`updatedAt`);
