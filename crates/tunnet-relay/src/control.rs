//! Optional registration + heartbeat against the Tunnet control plane.

use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct ControlClient {
    base: String,
    http: reqwest::Client,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody {
    url: String,
    region: String,
    qad_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    metrics_url: Option<String>,
    access_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    pub relay_id: String,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metrics: Option<serde_json::Value>,
}

impl ControlClient {
    pub fn new(base: String, token: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            http,
            token,
        })
    }

    pub async fn register(
        &self,
        url: &str,
        region: &str,
        qad_enabled: bool,
        metrics_url: Option<&str>,
        access_mode: &str,
    ) -> anyhow::Result<RegisterResponse> {
        let endpoint = format!("{}/v1/connectivity-relay/register", self.base);
        let resp = self
            .http
            .post(&endpoint)
            .header("authorization", format!("Bearer {}", self.token))
            .json(&RegisterBody {
                url: url.to_string(),
                region: region.to_string(),
                qad_enabled,
                metrics_url: metrics_url.map(str::to_string),
                access_mode: access_mode.to_string(),
            })
            .send()
            .await
            .with_context(|| format!("POST {endpoint}"))?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("connectivity-relay register failed: {status}: {text}");
        }
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn heartbeat(
        &self,
        status: Option<&str>,
        metrics: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let endpoint = format!("{}/v1/connectivity-relay/heartbeat", self.base);
        let resp = self
            .http
            .post(&endpoint)
            .header("authorization", format!("Bearer {}", self.token))
            .json(&HeartbeatBody {
                status: status.map(str::to_string),
                metrics,
            })
            .send()
            .await
            .with_context(|| format!("POST {endpoint}"))?;
        let status_code = resp.status();
        if !status_code.is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("connectivity-relay heartbeat failed: {status_code}: {text}");
        }
        Ok(())
    }

    /// Spawn a 30s heartbeat loop. Cancelled when the returned JoinHandle is aborted
    /// or the process exits.
    pub fn spawn_heartbeat_loop(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                if let Err(e) = self
                    .heartbeat(Some("healthy"), Some(serde_json::json!({ "ok": true })))
                    .await
                {
                    tracing::warn!(?e, "connectivity-relay heartbeat failed");
                }
            }
        })
    }
}
