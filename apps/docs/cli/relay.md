# tunnet-relay

Self-hosted **connectivity relay**. Used for mesh NAT traversal.

## Commands

```bash
# Local plaintext / --dev (HTTP on :3340)
tunnet-relay run --dev

# Production with TLS + control-plane registration
tunnet-relay run \
  --tls-cert /path/to/fullchain.pem \
  --tls-key /path/to/privkey.pem \
  --control-url http://control:8080 \
  --token RELAY_TOKEN \
  --relay-url https://relay.example.com \
  --region us-east
```

## Common options

| Flag | Env | Description |
|------|-----|-------------|
| `--config` / `-c` | `TUNNET_RELAY_CONFIG` | iroh-relay-compatible TOML |
| `--http-bind` | `TUNNET_RELAY_HTTP_BIND` | Plaintext HTTP bind |
| `--https-bind` | `TUNNET_RELAY_HTTPS_BIND` | HTTPS bind (needs TLS) |
| `--tls-cert` / `--tls-key` | `TUNNET_RELAY_TLS_CERT` / `TUNNET_RELAY_TLS_KEY` | Manual TLS PEMs |
| `--access-token` | `IROH_RELAY_ACCESS_TOKEN` | Shared client access token |
| `--control-url` | `TUNNET_CONTROL_URL` | Optional control plane base URL |
| `--token` | `TUNNET_RELAY_TOKEN` | Registration token for the control plane |
| `--relay-url` | `TUNNET_RELAY_URL` | Public URL advertised to the control plane |
| `--region` | `TUNNET_RELAY_REGION` | Region label |
| `--dev` | - | Plaintext localhost development mode |

See `tunnet-relay --help` and [self-hosting](/self-hosting/relay) for full details.
