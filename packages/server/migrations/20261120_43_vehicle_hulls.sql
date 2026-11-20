-- Vehicle hulls (issue #2). A rider's hull is `characters.hull`; a parked vehicle's is
-- `ground_items.hull`, with `parked_at` (ISO) for the repair it gains while parked. NULL is a full
-- hull, so riders and airships from before hulls start full.
ALTER TABLE characters ADD COLUMN hull INTEGER CHECK (hull IS NULL OR hull >= 0);
ALTER TABLE ground_items ADD COLUMN hull INTEGER CHECK (hull IS NULL OR hull >= 0);
ALTER TABLE ground_items ADD COLUMN parked_at TEXT;
