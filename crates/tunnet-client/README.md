# tunnet-client

Typed HTTP client for the Tunnet Local Management API (`/v1/...`).

Talk to a running `tunnetd` over a machine-local Unix socket (or Windows named pipe) using [`TunnetClient`](https://docs.rs/tunnet-client/latest/tunnet_client/struct.TunnetClient.html). JSON types are shared with the daemon via [`tunnet-common`](https://docs.rs/tunnet-common).

```rust
use tunnet_client::TunnetClient;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = TunnetClient::connect();
    let status = client.status(true).await?;
    println!("{} @ {}", status.hostname, status.ip);
    Ok(())
}
```

Endpoint path defaults to `$TUNNET_RUNTIME_DIR/tunnetd.sock` on Unix, or the system pipe marker on Windows. Override with `TUNNET_API_PATH` / `TUNNET_IPC_PATH`.
