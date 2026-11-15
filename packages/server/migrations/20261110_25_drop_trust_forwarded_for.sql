-- The proxy header is no longer an in-game setting; the operator sets SSO_PROXY_HOPS (the number of
-- reverse proxies in front). Drop any stored value.
DELETE FROM settings WHERE key = 'trustForwardedFor';
