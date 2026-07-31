use std::path::PathBuf;
use std::sync::Mutex;

use tunnet_client::{TunnetClient, default_api_path};

pub struct DesktopState {
    client: Mutex<Option<TunnetClient>>,
}

impl DesktopState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }

    pub fn api_path(&self) -> PathBuf {
        default_api_path()
    }

    pub async fn client(&self) -> anyhow::Result<TunnetClient> {
        let mut guard = self
            .client
            .lock()
            .map_err(|_| anyhow::anyhow!("client lock poisoned"))?;

        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }

        let client = TunnetClient::connect();
        *guard = Some(client.clone());
        Ok(client)
    }
}
