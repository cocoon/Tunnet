//! Endpoint connectivity presets for Direct and Managed agents.
//!
//! Selects iroh relay presets, optional Mainline DHT address lookup, and mDNS.

use iroh::Endpoint;
use iroh::endpoint::Builder;
use iroh::endpoint::presets;
#[cfg(feature = "direct")]
use iroh_mainline_address_lookup::DhtAddressLookup;

#[cfg(feature = "direct")]
use super::mdns::apply_mdns;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConnectivityProfile {
    /// [`presets::N0`] + optional mDNS.
    #[default]
    N0Public,
    /// [`presets::N0`] for Tunnet-managed agents (no DHT).
    TunnetManaged,
    /// [`presets::N0`] + DHT address lookup + optional mDNS.
    ServerlessDht,
    /// [`presets::Minimal`] + mDNS only (no N0 DNS).
    LanOnly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConnectivityOptions {
    pub profile: ConnectivityProfile,
    pub enable_mdns: bool,
}

impl Default for ConnectivityOptions {
    fn default() -> Self {
        Self {
            profile: ConnectivityProfile::N0Public,
            enable_mdns: true,
        }
    }
}

impl ConnectivityOptions {
    pub fn direct_default(enable_mdns: bool) -> Self {
        Self {
            profile: ConnectivityProfile::ServerlessDht,
            enable_mdns,
        }
    }

    pub fn managed_default() -> Self {
        Self {
            profile: ConnectivityProfile::TunnetManaged,
            enable_mdns: false,
        }
    }
}

/// Start an endpoint builder with the relay preset for this profile.
pub fn endpoint_builder(opts: &ConnectivityOptions) -> Builder {
    match opts.profile {
        ConnectivityProfile::LanOnly => Endpoint::builder(presets::Minimal),
        ConnectivityProfile::N0Public
        | ConnectivityProfile::TunnetManaged
        | ConnectivityProfile::ServerlessDht => Endpoint::builder(presets::N0),
    }
}

/// Attach address-lookup services to an endpoint builder.
pub fn apply_connectivity(builder: Builder, opts: &ConnectivityOptions) -> Builder {
    #[cfg(feature = "direct")]
    {
        let mut builder = builder;
        if matches!(opts.profile, ConnectivityProfile::ServerlessDht) {
            tracing::info!("Mainline DHT address lookup enabled");
            builder = builder.address_lookup(DhtAddressLookup::builder());
        }
        let mdns = opts.enable_mdns || matches!(opts.profile, ConnectivityProfile::LanOnly);
        apply_mdns(builder, mdns)
    }
    #[cfg(not(feature = "direct"))]
    {
        let _ = opts;
        builder
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_default_is_tunnet_managed() {
        let opts = ConnectivityOptions::managed_default();
        assert_eq!(opts.profile, ConnectivityProfile::TunnetManaged);
        assert!(!opts.enable_mdns);
    }

    #[cfg(feature = "direct")]
    #[test]
    fn direct_default_is_serverless_dht() {
        let opts = ConnectivityOptions::direct_default(true);
        assert_eq!(opts.profile, ConnectivityProfile::ServerlessDht);
        assert!(opts.enable_mdns);
    }

    #[cfg(feature = "direct")]
    #[test]
    fn lan_only_builder_uses_minimal() {
        let opts = ConnectivityOptions {
            profile: ConnectivityProfile::LanOnly,
            enable_mdns: false,
        };
        let _builder = endpoint_builder(&opts);
    }

    #[cfg(feature = "direct")]
    #[test]
    fn serverless_builder_uses_n0() {
        let opts = ConnectivityOptions::direct_default(false);
        let _builder = endpoint_builder(&opts);
    }
}
