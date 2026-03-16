-- Fix: include is_reverse in unique constraint to allow mutual same-type relations
-- A->B (depends-on, A, B, false) and B->A auto-reverse (depends-on, A, B, true) must coexist
DROP INDEX IF EXISTS uq_card_relation;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_card_relation ON card_relation(type, src_card_key, dst_card_key, is_reverse);
