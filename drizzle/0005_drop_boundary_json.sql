-- The `boundary` field was removed from card frontmatter when source `@spec`
-- annotations became the binding source of truth. The `boundary_json` column
-- has been written `null` since that change and is now dropped.
ALTER TABLE `card` DROP COLUMN `boundary_json`;
