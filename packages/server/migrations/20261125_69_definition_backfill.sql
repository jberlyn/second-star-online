-- Item definitions saved before an item's whole rule set was a definition (issue #30 stages 2-3)
-- hold no tools, needs, menu, breaking, worn pictures, ground, container or list toggles: under
-- the newer compile that would read as "none". They are listed here, once, and the server fills in
-- those groups from what the item played at its first start after this migration
-- (`ContentService.backfillDefinitions`), then empties the list. A database made after this
-- migration lists nothing.
CREATE TABLE content_definition_backfill (
  source TEXT NOT NULL CHECK (source IN ('layer', 'draft')),
  row_key TEXT NOT NULL,
  PRIMARY KEY (source, row_key)
);

INSERT INTO content_definition_backfill (source, row_key)
SELECT 'layer', row_key FROM content_rows
WHERE dataset = 'items' AND part = 'definitions' AND op = 'set';

INSERT INTO content_definition_backfill (source, row_key)
SELECT 'draft', row_key FROM content_draft
WHERE dataset = 'items' AND part = 'definitions' AND op = 'set';
