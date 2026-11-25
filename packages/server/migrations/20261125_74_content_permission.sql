-- One permission for all content: `contentEditor` takes in the World Editor's and NPC Editor's own
-- permissions (`worldEditor`, `npcEditor`), so anyone who may edit content may edit maps and NPC
-- files too. A role that held either of them keeps its pages by gaining `contentEditor` (and with
-- it every other content page); both old names leave every role. A role that held every
-- permission still does, so the lockout check still finds it.
UPDATE roles
SET permissions = json_insert(permissions, '$[#]', 'contentEditor'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1 FROM json_each(roles.permissions) WHERE value IN ('worldEditor', 'npcEditor')
)
AND NOT EXISTS (
  SELECT 1 FROM json_each(roles.permissions) WHERE value = 'contentEditor'
);

UPDATE roles
SET permissions = (
    SELECT coalesce(json_group_array(value), '[]')
    FROM (
      SELECT value FROM json_each(roles.permissions)
      WHERE value IS NULL OR value NOT IN ('worldEditor', 'npcEditor')
      ORDER BY key
    )
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1 FROM json_each(roles.permissions) WHERE value IN ('worldEditor', 'npcEditor')
);
