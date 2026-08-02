# Self-Hosting a Connectivity Relay

`tunnet-relay` wraps the official iroh-relay server for mesh NAT traversal. This is **not** the public tunnel edge - for tunnels see [Self-Hosting an Edge](/self-hosting/edge).

## Running with Docker

```yaml
# Add to docker-compose.yml services:
relay:
  build:
    context: .
    dockerfile: deploy/Dockerfile.relay
  restart: unless-stopped
  ports:
    - "80:80"
    - "443:443"
    - "9090:9090"
  environment:
    TUNNET_CONTROL_URL: "http://control:8080"
    TUNNET_RELAY_TOKEN: "YOUR_RELAY_TOKEN"
    TUNNET_RELAY_URL: "https://relay.example.com"
    TUNNET_RELAY_REGION: "us-east"
    # Optional shared access token for clients:
    # IROH_RELAY_ACCESS_TOKEN: "..."
```

The image is built from `deploy/Dockerfile.relay`. It exposes HTTP(S) (80/443), metrics (9090), iroh `--dev` HTTP (3340), and QAD QUIC (7842).

## Development / plaintext

For local testing (matches upstream iroh-relay `--dev`):

```bash
tunnet-relay run --dev
# HTTP plaintext on :3340 by default
```

## Production

Provide TLS certificates and bind HTTPS:

```bash
tunnet-relay run \
  --http-bind 0.0.0.0:80 \
  --https-bind 0.0.0.0:443 \
  --tls-cert /path/to/fullchain.pem \
  --tls-key /path/to/privkey.pem \
  --control-url http://control:8080 \
  --token YOUR_RELAY_TOKEN \
  --relay-url https://relay.example.com \
  --region us-east
```

You can also pass an iroh-relay-compatible TOML via `--config` / `TUNNET_RELAY_CONFIG`.

## Control plane registration

When `TUNNET_CONTROL_URL` and `TUNNET_RELAY_TOKEN` are set, the relay registers and heartbeats so the control plane can put its URL into agent connectivity snapshots (`RelayMode::Custom`).

## Related

- [Product overview](/products/connectivity-relay/)
- [CLI reference](/cli/relay)
- [Environment variables](/self-hosting/env)
