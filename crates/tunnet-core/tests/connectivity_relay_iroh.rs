//! Integration: two iroh Endpoints talk over an in-process connectivity relay.
//!
//! Uses iroh's `test_utils::run_relay_server` (same path as upstream endpoint
//! relay tests). This is the mesh DERP / `tunnet-relay` path - distinct from
//! public-ingress `tunnet-edge`.

use iroh::endpoint::presets;
use iroh::test_utils::run_relay_server;
use iroh::tls::CaTlsConfig;
use iroh::{Endpoint, RelayMode};

const ECHO_ALPN: &[u8] = b"tunnet/test/echo/1";

/// Spawn an in-process iroh-relay, force Custom relay mode (+ clear IP transports
/// so the path cannot fall back to direct), open a bi-stream, echo bytes.
///
/// Ignored by default on CI: Windows (and some sandboxed Linux runners) often
/// fail to bind the self-signed HTTPS/QUIC relay ports used by
/// `run_relay_server`. Run locally with:
/// `cargo test -p tunnet-core --test connectivity_relay_iroh -- --ignored --nocapture`
#[tokio::test]
#[ignore = "in-process iroh-relay bind is flaky on Windows CI; run with --ignored locally"]
async fn custom_relay_echo_bi_stream() {
    let (relay_map, _relay_url, _guard) = run_relay_server()
        .await
        .expect("spawn in-process iroh-relay");

    let server = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Custom(relay_map.clone()))
        .ca_tls_config(CaTlsConfig::insecure_skip_verify())
        .alpns(vec![ECHO_ALPN.to_vec()])
        .clear_ip_transports()
        .bind()
        .await
        .expect("bind server endpoint");
    server.online().await;

    let client = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Custom(relay_map))
        .ca_tls_config(CaTlsConfig::insecure_skip_verify())
        .clear_ip_transports()
        .bind()
        .await
        .expect("bind client endpoint");

    let server_addr = server.addr();
    let accept = tokio::spawn({
        let server = server.clone();
        async move {
            let incoming = server.accept().await.expect("accept");
            let conn = incoming.await.expect("handshake");
            let (mut send, mut recv) = conn.accept_bi().await.expect("accept_bi");
            let data = recv.read_to_end(64 * 1024).await.expect("read");
            send.write_all(&data).await.expect("echo write");
            send.finish().expect("finish");
            let _ = conn.closed().await;
        }
    });

    let conn = client
        .connect(server_addr, ECHO_ALPN)
        .await
        .expect("connect via custom relay");
    let (mut send, mut recv) = conn.open_bi().await.expect("open_bi");
    const PAYLOAD: &[u8] = b"tunnet-connectivity-relay";
    send.write_all(PAYLOAD).await.expect("write");
    send.finish().expect("finish");
    let echoed = recv.read_to_end(64 * 1024).await.expect("read echo");
    conn.close(0u32.into(), b"bye");

    accept.await.expect("accept task");
    client.close().await;
    server.close().await;

    assert_eq!(&echoed[..], PAYLOAD);
}
