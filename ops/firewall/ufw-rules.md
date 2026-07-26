# Firewall cutover

The server already uses TCP/UDP 443 and UDP 51820 for VPN services. Preserve
them exactly.

Before enabling UFW:

1. Open and verify a second SSH session.
2. Schedule an automatic rollback with `at` for five minutes later.
3. Add rules for `22/tcp`, `443/tcp`, `443/udp`, and `51820/udp`.
4. Deny incoming by default and allow outgoing.
5. Enable UFW.
6. From the second session, verify SSH and the existing VPN listeners.
7. Cancel the scheduled rollback only after both checks pass.

Port 3100 must not have an incoming rule. Confirm that it listens only on
`127.0.0.1`. Cloudflare Tunnel connects to it locally using an outbound
connection.
