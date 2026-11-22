-- The player hub's permission (issue #26): finding characters and reading their hub in the Control
-- Panel. A role that held every permission before keeps holding every permission, as in the
-- Control Panel migration, so the operator's full-access role is not left short and the lockout
-- check still finds it. Other roles, and a role that already holds it, are left as they are.
UPDATE roles
SET permissions = json_insert(permissions, '$[#]', 'characterView'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each('["save","refresh","cheatfile","unbanip","inventory","banip","location","iplookup","kick","warpscript","ban","warp","jail","pardon","warptome","warpmeto","unban","setclass","unjail","banlist","chatlog","auditlog","mute","unmute","drop","spawn","roster","worldEditor","npcEditor","settings","contentEditor","characterEditor","activityLog","adminChat","assassinGame","overrule","pardonSelf","warpSelf","invulnerable","noHunger","unpushable","noHighScores","bypassIpBan","bypassLoginLimits","dropOnEveryDeath","bypassChatCooldown","bypassBroadcastCooldown"]') AS old
  WHERE old.value NOT IN (
    SELECT value FROM json_each(roles.permissions) WHERE value IS NOT NULL)
)
AND NOT EXISTS (
  SELECT 1 FROM json_each(roles.permissions) WHERE value = 'characterView'
);
