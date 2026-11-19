-- Server infrastructure moved out of the Settings window into environment variables read at
-- startup: saveInterval → SSO_SAVE_INTERVAL, resumeGrace → SSO_RECONNECT_GRACE and socketsPerIp
-- → SSO_SOCKETS_PER_IP. The loader already ignores the old keys; their rows go so the settings
-- table holds only settings. An operator who had changed one sets the variable instead.
DELETE FROM settings WHERE key IN ('saveInterval', 'resumeGrace', 'socketsPerIp');
