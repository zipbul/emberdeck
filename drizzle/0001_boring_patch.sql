DROP INDEX `idx_card_file_path`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_file_path` ON `card` (`file_path`);