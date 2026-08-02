# Custom Domains

By default, tunnels get a subdomain on the edge's domain (e.g., `abc123.edge.example.com`). You can configure custom domains by pointing your DNS at the edge and configuring the tunnel in the dashboard.

The edge supports ACME (Let's Encrypt) for automatic TLS certificate provisioning on non-wildcard domains. For wildcard domains, bring your own certificates.

See the [Edge documentation](/products/edge/) for details on DNS and certificate configuration.
