# ACME & Certificates

The edge supports automatic TLS certificate provisioning via ACME (Let's Encrypt).

## Automatic certificates

For non-wildcard domains, the edge can automatically obtain and renew certificates from Let's Encrypt. Configure the ACME settings in the edge's startup options.

## Bring your own certificates

For wildcard domains or when you have existing certificates, provide them directly:

```bash
tunnet-edge run \
  --cert-file /path/to/fullchain.pem \
  --key-file /path/to/privkey.pem
```

## Certificate management

The edge handles certificate renewal automatically when using ACME. For manually provided certificates, you are responsible for renewal and restarting the edge.
