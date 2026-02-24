-- Add UNIQUE constraint on card_relation(type, src_card_key, dst_card_key)
CREATE UNIQUE INDEX IF NOT EXISTS `uq_card_relation` ON `card_relation` (`type`, `src_card_key`, `dst_card_key`);
--> statement-breakpoint
-- Add UNIQUE constraint on code_link(card_key, kind, file, symbol)
CREATE UNIQUE INDEX IF NOT EXISTS `uq_code_link` ON `code_link` (`card_key`, `kind`, `file`, `symbol`);
