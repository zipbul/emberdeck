CREATE TABLE `card` (
	`key` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`type` text NOT NULL,
	`parent` text,
	`namespaces_json` text,
	`body` text,
	`glossary_json` text DEFAULT '[]' NOT NULL,
	`file_path` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_card_status` ON `card` (`status`);--> statement-breakpoint
CREATE INDEX `idx_card_file_path` ON `card` (`file_path`);--> statement-breakpoint
CREATE INDEX `idx_card_type` ON `card` (`type`);--> statement-breakpoint
CREATE INDEX `idx_card_parent` ON `card` (`parent`);--> statement-breakpoint
CREATE TABLE `card_changelog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_key` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` text NOT NULL,
	`changed_by` text NOT NULL,
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_changelog_card` ON `card_changelog` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_changelog_changed_at` ON `card_changelog` (`changed_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE card_fts USING fts5(key, summary, body);
--> statement-breakpoint
CREATE TRIGGER card_ai AFTER INSERT ON card BEGIN
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER card_ad AFTER DELETE ON card BEGIN
  DELETE FROM card_fts WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER card_au AFTER UPDATE ON card BEGIN
  DELETE FROM card_fts WHERE rowid = old.rowid;
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
--> statement-breakpoint
CREATE TABLE `card_relation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`src_card_key` text NOT NULL,
	`dst_card_key` text NOT NULL,
	`is_reverse` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`src_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`dst_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_relation_src` ON `card_relation` (`src_card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_relation_dst` ON `card_relation` (`dst_card_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_card_relation` ON `card_relation` (`src_card_key`,`dst_card_key`,`is_reverse`);--> statement-breakpoint
CREATE TABLE `card_tag` (
	`card_key` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`card_key`, `tag_id`),
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_tag_card` ON `card_tag` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_tag_tag` ON `card_tag` (`tag_id`);--> statement-breakpoint
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
CREATE INDEX `idx_code_link_file` ON `code_link` (`file`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_code_link` ON `code_link` (`card_key`,`kind`,`file`,`symbol`);--> statement-breakpoint
CREATE TABLE `system_lock` (
	`name` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`start_time_ticks` integer NOT NULL,
	`acquired_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);