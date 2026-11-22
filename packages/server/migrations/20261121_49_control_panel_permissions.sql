-- The Control Panel's permissions (issue #24): editing content, editing characters and reading the
-- activity log. A role that held every permission before keeps holding every permission, so the
-- operator's full-access role (the seeded administrator, or one they made) is not left short and
-- the lockout check still finds it. Other roles are left as they are. A non-string entry (only a
-- hand edit makes one) is ignored, as the server ignores it when it loads the role.
UPDATE roles
SET permissions = json_insert(permissions, '$[#]', 'contentEditor', '$[#]', 'characterEditor',
    '$[#]', 'activityLog'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each('["save","refresh","cheatfile","unbanip","inventory","banip","location","iplookup","kick","warpscript","ban","warp","jail","pardon","warptome","warpmeto","unban","setclass","unjail","banlist","chatlog","auditlog","mute","unmute","drop","spawn","roster","worldEditor","npcEditor","settings","adminChat","assassinGame","overrule","pardonSelf","warpSelf","invulnerable","noHunger","unpushable","noHighScores","bypassIpBan","bypassLoginLimits","dropOnEveryDeath","bypassChatCooldown","bypassBroadcastCooldown"]') AS old
  WHERE old.value NOT IN (
    SELECT value FROM json_each(roles.permissions) WHERE value IS NOT NULL)
);
