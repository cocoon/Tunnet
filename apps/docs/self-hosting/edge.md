# Self-Hosting an Edge

The edge (`tunnet-edge`) is an optional component for organizations that need public tunnels (`tunnet tunnel`). It is a standalone Rust binary that terminates public HTTPS/TCP connections and forwards them to agents through reverse tunnels.

## Running with Docker

The edge is **not** included in the default `docker-compose.yml` because it requires public DNS pointing to your server and TLS certificates. To add it:

```yaml
# Add to docker-compose.yml services:
edge:
  build:
    context: .
    dockerfile: deploy/Dockerfile.edge
  restart: unless-stopped
  depends_on:
    control:
      condition: service_started
  ports:
    - "443:443"
    - "80:80"
  environment:
    CONTROL_PLANE_URL: "http://control:8080"
  volumes:
    - edge-certs:/etc/tunnet/certs

# Add to volumes:
volumes:
  pgdata:
  edge-certs:
```

The edge image is built from `deploy/Dockerfile.edge` - a simple multi-stage Rust build into `debian:bookworm-slim`. It exposes ports 80 and 443.

## Running manually

```bash
# Register the edge with the control plane
tunnet-edge register \
  --control-url http://control:8080 \
  --token YOUR_EDGE_TOKEN

# Run the edge
tunnet-edge run
```

## DNS setup

Point your tunnel wildcard domain at the edge server's public IP:

```
*.tunnel.example.com  →  A  →  <edge-public-ip>
```

## TLS certificates

The edge needs TLS certificates to terminate public HTTPS. You have three options:

**ACME (Let's Encrypt)** - the edge can automatically obtain and renew certificates. Configure the ACME settings in the edge startup options.

**Bring your own certs** - pass certificates directly:

```bash
tunnet-edge run \
  --cert-file /path/to/fullchain.pem \
  --key-file /path/to/privkey.pem
```

**Reverse proxy** - put the edge behind a reverse proxy (Caddy, nginx, Traefik) that handles TLS termination, and run the edge in HTTP mode.

See `tunnet-edge --help` for all available options.
