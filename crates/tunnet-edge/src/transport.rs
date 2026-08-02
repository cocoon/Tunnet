//! Abstraction over edge→agent reverse-tunnel data paths.
//!
//! The only implementation today is QUIC (`QuicAgentTransport`). HTTPS/TCP
//! listeners depend on this trait so a future transport can be swapped in
//! without rewriting public listeners.

use std::sync::Arc;

use async_trait::async_trait;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use tunnet_common::edge::EdgeCtrl;

/// Bidirectional byte stream opened toward an agent.
pub struct AgentStream {
    pub send: SendStream,
    pub recv: RecvStream,
}

impl AgentStream {
    pub async fn write_all(&mut self, buf: &[u8]) -> anyhow::Result<()> {
        self.send.write_all(buf).await?;
        Ok(())
    }
}

/// Edge→agent session used to open per-connection data streams.
#[async_trait]
pub trait AgentTransport: Send + Sync {
    /// Open a raw bi-stream (HTTPS: agent peeks the request).
    async fn open_raw(&self) -> anyhow::Result<AgentStream>;

    /// Open a bi-stream and send [`EdgeCtrl::Forward`] (TCP mappings).
    async fn open_forward(
        &self,
        target_port: u16,
        target_ip: Option<String>,
    ) -> anyhow::Result<AgentStream>;
}

/// QUIC reverse-tunnel transport over an iroh connection.
#[derive(Clone)]
pub struct QuicAgentTransport {
    conn: Connection,
}

impl QuicAgentTransport {
    pub fn new(conn: Connection) -> Arc<Self> {
        Arc::new(Self { conn })
    }
}

#[async_trait]
impl AgentTransport for QuicAgentTransport {
    async fn open_raw(&self) -> anyhow::Result<AgentStream> {
        let (send, recv) = self.conn.open_bi().await?;
        Ok(AgentStream { send, recv })
    }

    async fn open_forward(
        &self,
        target_port: u16,
        target_ip: Option<String>,
    ) -> anyhow::Result<AgentStream> {
        let mut stream = self.open_raw().await?;
        stream
            .write_all(
                &EdgeCtrl::Forward {
                    target_port,
                    target_ip,
                }
                .to_line()?,
            )
            .await?;
        Ok(stream)
    }
}
