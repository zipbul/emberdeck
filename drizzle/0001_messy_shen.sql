CREATE TABLE `code_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`kind` text NOT NULL,
	`file` text NOT NULL,
	`symbol` text NOT NULL,
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_link_card` ON `code_link` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_code_link_symbol` ON `code_link` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_code_link_file` ON `code_link` (`file`);