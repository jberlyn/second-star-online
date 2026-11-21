-- Keep stations placed under the original name while the feature was in development.
UPDATE ground_items
SET item = 'Carpentry Bench'
WHERE kind = 'admin' AND item = 'Workbench' COLLATE NOCASE;
