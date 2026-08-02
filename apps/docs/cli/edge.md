# tunnet-edge

Running self-hosted **public tunnel** edge servers.

## Commands

```bash
# Register with the control plane
tunnet-edge register \
  --control-url http://control:8080 \
  --token EDGE_TOKEN

# Run the edge
tunnet-edge run
```

## Options

See `tunnet-edge --help` for all options including HTTPS bind address, certificate files, and ACME configuration.
