ALTER TABLE `card` ADD COLUMN `type` text;--> statement-breakpoint
ALTER TABLE `card` ADD COLUMN `priority` text;--> statement-breakpoint
ALTER TABLE `card` ADD COLUMN `acceptance_json` text;--> statement-breakpoint
CREATE INDEX `idx_card_type` ON `card` (`type`);--> statement-breakpoint
CREATE INDEX `idx_card_priority` ON `card` (`priority`);--> statement-breakpoint
CREATE TABLE `card_changelog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` text NOT NULL,
	`changed_by` text NOT NULL,
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_changelog_card` ON `card_changelog` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_changelog_changed_at` ON `card_changelog` (`changed_at`);
