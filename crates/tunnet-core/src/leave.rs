//! Offline Direct network leave (disk only; caller may reload the agent).

use anyhow::Context;

use crate::secret_store::{SealPolicy, load_agent, persist_agent};
use crate::state::StatePaths;

/// Remove a Direct network from persisted state and delete its docs dir.
///
/// Works without a running daemon. Returns the left network's name.
/// Refuses to leave the last Direct network (use reset instead).
pub fn leave_direct_network(
    paths: &StatePaths,
    policy: SealPolicy,
    network: Option<&str>,
) -> anyhow::Result<String> {
    let (identity, mut persisted, _) = load_agent(paths, policy)?;
    let direct = persisted.require_direct_network(network)?.clone();
    let nid = direct.network_id;
    let nname = direct.network_name.clone();
    let Some(networks) = persisted.direct_networks_mut() else {
        anyhow::bail!("not in Direct mode");
    };
    networks.retain(|d| d.network_id != nid);
    if networks.is_empty() {
        anyhow::bail!("leaving the last Direct network; use `tunnet reset --yes` instead");
    }
    let docs = paths.docs_dir(nid);
    if docs.exists() {
        let _ = std::fs::remove_dir_all(&docs);
    }
    persist_agent(paths, &identity, persisted, policy)
        .with_context(|| format!("persist state after leaving '{nname}'"))?;
    Ok(nname)
}
