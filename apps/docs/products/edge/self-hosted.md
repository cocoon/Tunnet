# Self-Hosted Edge Setup

## 1. Register the edge

In the dashboard, navigate to **Edges** and create an edge registration token.

## 2. Register and run

```bash
tunnet-edge register \
  --control-url http://your-control-host:8080 \
  --token YOUR_EDGE_TOKEN

tunnet-edge run
```

## 3. Configure DNS

Point your tunnel domain (e.g., `*.tunnel.example.com`) at the edge server's public IP.

## 4. Configure HTTPS

The edge binds an HTTPS listener for public traffic. You can provide TLS certificates in several ways: with `--cert-file` and `--key-file` flags for your own certificates, or by enabling ACME (Let's Encrypt) for automatic provisioning.

## Options

See `tunnet-edge --help` for all available options including HTTPS bind address, ACME configuration, and certificate paths.
