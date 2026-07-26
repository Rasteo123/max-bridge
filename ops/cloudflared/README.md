# Cloudflare Tunnel

The bridge must be published through a remotely managed tunnel named
`max-users-production`. The application itself listens only on
`127.0.0.1:3100`; no new public TCP port is opened.

Create the staging route first:

```text
staging.max-users.online -> http://127.0.0.1:3100
```

After the owner and one-friend pilot succeeds, add:

```text
max-users.online -> http://127.0.0.1:3100
```

Install the tunnel token as a root-only systemd credential or with the official
remotely-managed-tunnel installer. Never place the token in this repository,
deployment archives, command history, screenshots, or logs.

The Cloudflare configuration must keep WebSockets enabled and TLS mode at
`Full (strict)`. Do not proxy or modify the existing VPN listeners on TCP/UDP
443.

Keep `/etc/maxbridge/config.env` root-owned with mode `0600`. It contains
only non-secret runtime switches:

```ini
MAXBRIDGE_ADMIN_TELEGRAM_ID=123456789
MAXBRIDGE_BOT_ENABLED=false
```

Set `MAXBRIDGE_BOT_ENABLED=true` only at the final cutover after the old
polling bot has stopped.
