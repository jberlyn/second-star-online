-- `/pardon`, `/IPlookup`, `/save` and `/Refresh` are administrators' by default. The moderator role
-- loses them only while it still holds exactly the permissions the roles migration seeded (in any
-- order), so a role the operator has edited is left as it is.
UPDATE roles
SET permissions = '["inventory","location","kick","ban","jail","unban","unjail","banlist","mute","unmute","bypassLoginLimits"]',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'moderator'
  AND (SELECT group_concat(value, ',') FROM (SELECT value FROM json_each(roles.permissions) ORDER BY value))
    = 'ban,banlist,bypassLoginLimits,inventory,iplookup,jail,kick,location,mute,pardon,refresh,save,unban,unjail,unmute';
