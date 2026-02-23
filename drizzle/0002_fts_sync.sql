-- Remove broken nullable rowid column from card table
ALTER TABLE card DROP COLUMN rowid;
--> statement-breakpoint
-- Drop old content-based FTS (content_rowid=rowid referenced the nullable column above — broken)
DROP TABLE IF EXISTS card_fts;
--> statement-breakpoint
-- Recreate FTS5 as standalone table (stores its own index, synced via triggers)
CREATE VIRTUAL TABLE card_fts USING fts5(key, summary, body);
--> statement-breakpoint
-- Trigger: populate FTS index on INSERT
CREATE TRIGGER card_ai AFTER INSERT ON card BEGIN
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
--> statement-breakpoint
-- Trigger: remove from FTS index on DELETE
CREATE TRIGGER card_ad AFTER DELETE ON card BEGIN
  DELETE FROM card_fts WHERE rowid = old.rowid;
END;
--> statement-breakpoint
-- Trigger: update FTS index on UPDATE (delete old entry, insert new)
CREATE TRIGGER card_au AFTER UPDATE ON card BEGIN
  DELETE FROM card_fts WHERE rowid = old.rowid;
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
