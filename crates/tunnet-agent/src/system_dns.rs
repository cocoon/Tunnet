//! OS DNS integration for PeerDNS, implemented with [`osdns`].
//!
//! Tunnet owns DNS *product policy* here; `osdns` owns OS DNS mutation,
//! ownership, journaling, restoration, watching, reconciliation, crash
//! recovery, and all platform-specific behavior.
//!
//! Lifecycle (blocking control-plane calls; invoke via
//! `tokio::task::spawn_blocking` from async code):
//!
//! ```text
//! DnsController::create(ifname)          // manager + recover_stale + watch
//!        ↓
//! capture underlay upstream (PeerDNS start, before overlay)
//!        ↓
//! apply(ifname, magic_ip, suffix)        // validate → apply → hold Lease
//!        ↓
//! update(...) on config change           // Lease::update, same resources
//!        ↓
//! restore() on dataplane stop            // explicit; abandon on conflict
//! ```
//!
//! If the TUN interface is destroyed and recreated with a new native
//! identity, the old lease is restored/released and a new lease is applied:
//! [`Lease::update`] cannot silently change the owned resource set, and this
//! module does not work around that guarantee.

use std::ffi::OsString;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

use osdns::{
    Capabilities, ConflictPolicy, DnsConfig, DnsEvent, DnsManager, DnsScope, InterfaceSelector,
    Lease, RecoveryOutcome, RestoreFailure, WatchHandle,
};

/// Owner tag for every lease, journal record, and platform ownership marker.
pub const OWNER: &str = "io.tunnet.agent";

/// Tunnet's DNS product-policy holder: one long-lived [`DnsManager`], at most
/// one active [`Lease`], and the native [`WatchHandle`].
///
/// This is intentionally not a wrapper around `osdns`: it contains only
/// Tunnet-specific policy (capability-driven split/full fallback, TUN
/// interface targeting, lifecycle wiring). Callers use [`osdns`] types
/// directly wherever they represent the domain.
pub struct DnsController {
    manager: DnsManager,
    state: parking_lot::Mutex<State>,
}

struct State {
    lease: Option<Lease>,
    /// Kept alive for the manager/dataplane lifetime; required for
    /// `ConflictPolicy::Enforce` reconciliation. Stopped on [`DnsController::shutdown`].
    _watch: Option<WatchHandle>,
    applied_ifname: Option<String>,
}

impl DnsController {
    /// Build the agent's long-lived DNS integration: manager (Enforce),
    /// stale-journal recovery, capability logging, and the native watcher.
    ///
    /// Blocking; call via `spawn_blocking` from async code.
    pub fn create(ifname: &str) -> osdns::Result<Arc<Self>> {
        let manager = DnsManager::builder()
            .owner(OWNER)
            .conflict_policy(ConflictPolicy::Enforce)
            .build()?;
        Self::wrap(manager, ifname)
    }

    /// Shared initialization for production managers and
    /// `osdns::testing` fake-backend managers.
    pub fn wrap(manager: DnsManager, ifname: &str) -> osdns::Result<Arc<Self>> {
        recover_stale(&manager)?;
        match manager.capabilities() {
            Ok(caps) => tracing::info!(
                backend = %caps.backend,
                read = caps.read,
                global_dns = caps.global_dns,
                per_interface_dns = caps.per_interface_dns,
                split_dns = caps.split_dns,
                watch = caps.watch,
                cache_flush = caps.cache_flush,
                "osdns DNS integration enabled"
            ),
            Err(e) => tracing::warn!(error = %e, "osdns capabilities unavailable"),
        }
        let this = Arc::new(Self {
            manager,
            state: parking_lot::Mutex::new(State {
                lease: None,
                _watch: None,
                applied_ifname: Some(ifname.to_string()),
            }),
        });
        // Enforce reconciliation only runs while the watch is active. The
        // callback only observes for tracing/status; osdns owns
        // reconciliation, so no second engine is built here.
        let callback: osdns::WatchCallback = Arc::new(|event: &DnsEvent| {
            tracing::debug!(?event, "osdns observed DNS change");
        });
        match this.manager.watch(callback) {
            Ok(handle) => {
                this.state.lock()._watch = Some(handle);
                tracing::info!("osdns native DNS watcher active");
            }
            Err(e) => tracing::warn!(
                error = %e,
                "osdns watch unavailable; Enforce reconciliation inactive"
            ),
        }
        Ok(this)
    }

    /// The underlying manager for direct `osdns` operations
    /// (e.g. `snapshot`). Prefer this over adding forwarding methods.
    #[allow(dead_code)]
    pub fn manager(&self) -> &DnsManager {
        &self.manager
    }

    /// Whether a PeerDNS lease is currently held.
    pub fn is_active(&self) -> bool {
        self.state.lock().lease.is_some()
    }

    /// Interface name the active lease was applied for, if any.
    pub fn applied_ifname(&self) -> Option<String> {
        self.state.lock().applied_ifname.clone()
    }

    /// Apply the PeerDNS overlay (validate → apply → hold lease).
    /// Delegates to [`DnsController::update`] when a lease already exists.
    ///
    /// Blocking; call via `spawn_blocking`. On failure nothing is mutated
    /// that was not already ours, and [`DnsController::is_active`] stays
    /// `false` so callers never claim PeerDNS is active without the overlay.
    pub fn apply(&self, ifname: &str, magic_ip: Ipv4Addr, suffix: &str) -> osdns::Result<()> {
        if self.state.lock().lease.is_some() {
            return self.update(ifname, magic_ip, suffix);
        }
        self.apply_fresh(ifname, magic_ip, suffix)
    }

    /// Move to a new desired configuration.
    ///
    /// Same interface identity → [`Lease::update`], preserving the original
    /// snapshots so a later [`DnsController::restore`] still returns to the
    /// pre-lease (or rebased) base. A changed TUN identity or resource set
    /// (suffix routing domains) → explicit restore + fresh apply, never a
    /// silent ownership change.
    ///
    /// Blocking; call via `spawn_blocking`.
    pub fn update(&self, ifname: &str, magic_ip: Ipv4Addr, suffix: &str) -> osdns::Result<()> {
        let needs_reapply = self
            .state
            .lock()
            .applied_ifname
            .as_deref()
            .is_some_and(|applied| applied != ifname);
        if needs_reapply {
            tracing::info!(
                old = self.applied_ifname().unwrap_or_default(),
                new = ifname,
                "TUN identity changed; releasing old DNS lease for a new one"
            );
            self.restore()?;
            return self.apply_fresh(ifname, magic_ip, suffix);
        }
        if self.state.lock().lease.is_none() {
            return self.apply_fresh(ifname, magic_ip, suffix);
        }
        let caps = self.manager.capabilities()?;
        let config = desired_config(&caps, interface_selector(ifname), magic_ip, suffix)?;
        // Borrow the lease without holding the mutex across the blocking call.
        let result = {
            let state = self.state.lock();
            let lease = state.lease.as_ref().expect("checked above");
            self.manager.validate(&config)?;
            lease.update(&config)
        };
        match result {
            Ok(()) => {
                tracing::info!(%magic_ip, suffix, ifname, "PeerDNS lease updated");
                self.flush_cache_best_effort();
                Ok(())
            }
            Err(osdns::Error::InvalidConfig(detail)) => {
                // The target resource set differs (e.g. routing domains
                // changed); ownership cannot silently move, so re-apply.
                tracing::info!(%detail, "DNS resource set changed; re-applying lease");
                self.restore()?;
                self.apply_fresh(ifname, magic_ip, suffix)
            }
            Err(e) => {
                tracing::error!(error = %e, "PeerDNS lease update failed");
                Err(e)
            }
        }
    }

    /// Explicit restoration (the normal shutdown path; do not rely on `Drop`).
    ///
    /// On external modification the foreign state wins: the lease is
    /// abandoned without mutating the system, per `osdns` semantics. Other
    /// failures keep the lease so the caller can retry.
    ///
    /// Blocking; call via `spawn_blocking`.
    pub fn restore(&self) -> osdns::Result<()> {
        let lease = self.state.lock().lease.take();
        let Some(lease) = lease else { return Ok(()) };
        match lease.restore() {
            Ok(()) => {
                tracing::info!("PeerDNS lease restored");
                self.flush_cache_best_effort();
                Ok(())
            }
            Err(failure) if failure.error.is_external_modification() => {
                tracing::warn!(
                    error = %failure.error,
                    "OS DNS changed externally; leaving external state untouched"
                );
                if let Err(e) = failure.lease.abandon() {
                    tracing::warn!(error = %e, "abandoning conflicted DNS lease failed");
                }
                Ok(())
            }
            Err(failure) => {
                tracing::error!(error = %failure.error, "PeerDNS lease restore failed");
                let RestoreFailure { error, lease } = failure;
                self.state.lock().lease = Some(lease);
                Err(error)
            }
        }
    }

    /// Explicit teardown: restore the lease, then stop the native watcher.
    /// Dropping without this still best-effort restores via `osdns`, but
    /// correctness never depends on `Drop`.
    ///
    /// Blocking; call via `spawn_blocking`.
    pub fn shutdown(&self) {
        if let Err(e) = self.restore() {
            tracing::warn!(error = %e, "DNS shutdown restore failed; lease retained");
        }
        let watch = self.state.lock()._watch.take();
        drop(watch);
    }

    fn apply_fresh(&self, ifname: &str, magic_ip: Ipv4Addr, suffix: &str) -> osdns::Result<()> {
        let caps = self.manager.capabilities()?;
        let config = desired_config(&caps, interface_selector(ifname), magic_ip, suffix)?;
        self.manager.validate(&config)?;
        match self.manager.apply(&config) {
            Ok(lease) => {
                if lease.is_noop() {
                    tracing::info!(
                        %magic_ip,
                        suffix,
                        ifname,
                        "PeerDNS DNS already in effect; no-op lease"
                    );
                } else {
                    tracing::info!(
                        %magic_ip,
                        suffix,
                        ifname,
                        backend = %caps.backend,
                        split = caps.split_dns,
                        "PeerDNS lease applied"
                    );
                }
                self.state.lock().lease = Some(lease);
                self.state.lock().applied_ifname = Some(ifname.to_string());
                self.flush_cache_best_effort();
                Ok(())
            }
            Err(e) => {
                log_apply_failure(&e);
                Err(e)
            }
        }
    }

    fn flush_cache_best_effort(&self) {
        let caps = match self.manager.capabilities() {
            Ok(caps) => caps,
            Err(_) => return,
        };
        if !caps.cache_flush {
            return;
        }
        if let Err(e) = self.manager.flush_cache() {
            tracing::warn!(error = %e, "osdns DNS cache flush failed");
        }
    }
}

/// Resolve Tunnet's TUN interface to the backend's stable identity selector.
///
/// The selector is resolved by `osdns` to the backend's native identity, so
/// renames never silently retarget a lease. Prefer the interface index where
/// reliably available; macOS rejects `Index`, so the name is used there.
pub fn interface_selector(ifname: &str) -> InterfaceSelector {
    #[cfg(target_os = "macos")]
    {
        InterfaceSelector::Name(OsString::from(ifname))
    }
    #[cfg(not(target_os = "macos"))]
    {
        #[cfg(unix)]
        if let Ok(cstr) = std::ffi::CString::new(ifname) {
            // SAFETY: `cstr` is a valid NUL-terminated string that
            // `if_nametoindex` only reads; a 0 return means "no such
            // interface", in which case we fall back to the name selector.
            let index = unsafe { libc::if_nametoindex(cstr.as_ptr()) };
            if index != 0 {
                return InterfaceSelector::Index(index);
            }
        }
        InterfaceSelector::Name(OsString::from(ifname))
    }
}

/// Tunnet's capability-driven DNS strategy.
///
/// Preferred order: per-interface PeerDNS + routing domain (split DNS, so
/// only Tunnet suffixes go to PeerDNS and everything else uses normal
/// resolution with `default_route(false)` so the PeerDNS link never becomes
/// the default route) → broader per-interface/global PeerDNS fallback, where
/// PeerDNS resolves Tunnet names internally and external names through
/// Hickory → explicit unsupported error. Product policy only; `osdns`
/// translates the result into systemd-resolved / NetworkManager / resolvconf
/// / IP Helper + NRPT / SystemConfiguration mechanics.
pub fn desired_config(
    caps: &Capabilities,
    selector: InterfaceSelector,
    nameserver: Ipv4Addr,
    suffix: &str,
) -> osdns::Result<DnsConfig> {
    let nameserver = IpAddr::V4(nameserver);
    if caps.per_interface_dns && caps.split_dns {
        return DnsConfig::builder(DnsScope::Interface(selector))
            .nameserver(nameserver)
            .routing_domain(suffix)
            .default_route(false)
            .build();
    }
    if caps.per_interface_dns {
        tracing::warn!(
            "split DNS unavailable; routing all relevant DNS through PeerDNS (Hickory forwards external names)"
        );
        return DnsConfig::builder(DnsScope::Interface(selector))
            .nameserver(nameserver)
            .build();
    }
    if caps.global_dns {
        tracing::warn!(
            "per-interface DNS unavailable; routing system DNS through PeerDNS (Hickory forwards external names)"
        );
        return DnsConfig::builder(DnsScope::Global)
            .nameserver(nameserver)
            .build();
    }
    Err(osdns::Error::Unsupported {
        backend: caps.backend,
        reason: "backend supports neither per-interface nor global DNS".into(),
    })
}

/// Agent-startup crash recovery: let `osdns` inspect its durable journal and
/// safely recover stale ownership from a crashed daemon process.
///
/// Never guesses ownership: external conflicts are surfaced and left
/// untouched rather than blindly restoring old DNS state. Corrupt journals
/// fail closed.
fn recover_stale(manager: &DnsManager) -> osdns::Result<()> {
    match manager.recover_stale() {
        Ok(outcomes) => {
            for outcome in outcomes {
                match outcome {
                    RecoveryOutcome::Restored { resource, lease_id } => {
                        tracing::info!(?resource, %lease_id, "recovered stale DNS transaction")
                    }
                    RecoveryOutcome::JournalCleared { resource, lease_id } => {
                        tracing::info!(?resource, %lease_id, "cleared stale DNS journal")
                    }
                    RecoveryOutcome::ExternalConflict { resource, lease_id } => {
                        tracing::error!(
                            ?resource,
                            %lease_id,
                            "stale DNS transaction conflicts with external state; left untouched"
                        )
                    }
                    RecoveryOutcome::Busy { resource } => {
                        tracing::warn!(?resource, "stale DNS resource busy; left untouched")
                    }
                    _ => tracing::debug!("unrecognized DNS recovery outcome"),
                }
            }
            Ok(())
        }
        Err(e) => {
            tracing::error!(error = %e, "DNS journal recovery failed; failing closed");
            Err(e)
        }
    }
}

fn log_apply_failure(e: &osdns::Error) {
    match e {
        osdns::Error::RequiresPrivilege(_) => {
            tracing::error!(error = %e, "PeerDNS OS configuration needs elevated privileges")
        }
        osdns::Error::Unsupported { .. } => {
            tracing::error!(error = %e, "PeerDNS OS configuration unsupported on this backend")
        }
        _ => tracing::error!(error = %e, "PeerDNS OS configuration failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use osdns::BackendKind;

    fn split_caps() -> Capabilities {
        Capabilities::new(BackendKind::Fake)
            .with_per_interface_dns(true)
            .with_split_dns(true)
    }

    fn selector() -> InterfaceSelector {
        InterfaceSelector::Name(OsString::from("tunnet0"))
    }

    #[test]
    fn split_capable_backend_uses_routing_domain_without_default_route() {
        let config = desired_config(
            &split_caps(),
            selector(),
            Ipv4Addr::new(100, 100, 100, 53),
            "tunnet",
        )
        .unwrap();
        assert_eq!(config.nameservers(), &[IpAddr::from([100, 100, 100, 53])]);
        assert_eq!(config.routing_domains().len(), 1);
        assert!(
            format!("{:?}", config.routing_domains()).contains("tunnet"),
            "routing domain should carry the Tunnet suffix"
        );
        assert_eq!(config.default_route(), Some(false));
        assert_eq!(
            *config.scope(),
            DnsScope::Interface(InterfaceSelector::Name(OsString::from("tunnet0")))
        );
    }

    #[test]
    fn multiple_routing_domains_preserved_when_supported() {
        let config = DnsConfig::builder(DnsScope::Interface(selector()))
            .nameserver(IpAddr::from([100, 100, 100, 53]))
            .routing_domain("tunnet")
            .routing_domain("office.tunnet")
            .default_route(false)
            .build()
            .unwrap();
        assert_eq!(config.routing_domains().len(), 2);
    }

    #[test]
    fn backend_without_split_dns_uses_full_peerdns_fallback() {
        let caps = Capabilities::new(BackendKind::Fake).with_per_interface_dns(true);
        let config = desired_config(
            &caps,
            selector(),
            Ipv4Addr::new(100, 100, 100, 53),
            "tunnet",
        )
        .unwrap();
        assert!(config.routing_domains().is_empty());
        assert_eq!(config.nameservers(), &[IpAddr::from([100, 100, 100, 53])]);
        assert!(matches!(config.scope(), DnsScope::Interface(_)));
    }

    #[test]
    fn global_only_backend_uses_global_fallback() {
        let caps = Capabilities::new(BackendKind::Fake).with_global_dns(true);
        let config = desired_config(
            &caps,
            selector(),
            Ipv4Addr::new(100, 100, 100, 53),
            "tunnet",
        )
        .unwrap();
        assert_eq!(*config.scope(), DnsScope::Global);
        assert_eq!(config.nameservers(), &[IpAddr::from([100, 100, 100, 53])]);
    }

    #[test]
    fn unsupported_capability_combination_fails_clearly() {
        let caps = Capabilities::new(BackendKind::Fake);
        let err = desired_config(
            &caps,
            selector(),
            Ipv4Addr::new(100, 100, 100, 53),
            "tunnet",
        )
        .expect_err("backend with no DNS scope must fail");
        assert!(matches!(err, osdns::Error::Unsupported { .. }));
    }

    #[test]
    fn configurable_interface_name_is_respected() {
        let config = desired_config(
            &split_caps(),
            InterfaceSelector::Name(OsString::from("custom0")),
            Ipv4Addr::new(100, 100, 100, 53),
            "tunnet",
        )
        .unwrap();
        assert_eq!(
            *config.scope(),
            DnsScope::Interface(InterfaceSelector::Name(OsString::from("custom0")))
        );
    }

    #[test]
    fn selector_never_uses_default_scope() {
        // Tunnet always knows its TUN interface; Default would be wrong.
        let selector = interface_selector("tunnet0");
        assert!(!matches!(selector, InterfaceSelector::Default));
        #[cfg(target_os = "macos")]
        assert_eq!(selector, InterfaceSelector::Name(OsString::from("tunnet0")));
    }

    mod backend_tests {
        use super::*;
        use osdns::ConflictPolicy;
        use osdns::testing::{FakeDns, FakeState, manager_for_testing_with_policy};
        use std::time::Duration;

        fn enforce_manager(caps: Capabilities) -> (DnsManager, FakeDns, tempfile::TempDir) {
            let dir = tempfile::tempdir().unwrap();
            let fake = FakeDns::with_capabilities(caps);
            let manager = manager_for_testing_with_policy(
                "io.tunnet.agent",
                dir.path(),
                &fake,
                Duration::from_secs(5),
                ConflictPolicy::Enforce,
            )
            .unwrap();
            (manager, fake, dir)
        }

        fn full_caps() -> Capabilities {
            Capabilities::new(BackendKind::Fake)
                .with_read(true)
                .with_per_interface_dns(true)
                .with_split_dns(true)
                .with_global_dns(true)
                .with_watch(true)
                .with_cache_flush(true)
        }

        // The fake backend exposes fixed interfaces `eth0` (index 1) and
        // `wlan1` (index 2); interface-scoped tests must target those.
        #[test]
        fn lease_lifecycle_apply_update_restore() {
            let (manager, _fake, _dir) = enforce_manager(full_caps());
            let dns = DnsController::wrap(manager, "eth0").unwrap();
            assert!(!dns.is_active());

            dns.apply("eth0", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .unwrap();
            assert!(dns.is_active());

            dns.update("eth0", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .unwrap();
            assert!(dns.is_active());

            dns.restore().unwrap();
            assert!(!dns.is_active());

            // Restoring without a lease is a no-op success.
            dns.restore().unwrap();
        }

        #[test]
        fn tun_recreation_releases_old_lease_and_applies_new() {
            let (manager, _fake, _dir) = enforce_manager(full_caps());
            let dns = DnsController::wrap(manager, "eth0").unwrap();
            dns.apply("eth0", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .unwrap();
            assert_eq!(dns.applied_ifname().as_deref(), Some("eth0"));

            dns.update("wlan1", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .unwrap();
            assert!(dns.is_active());
            assert_eq!(dns.applied_ifname().as_deref(), Some("wlan1"));

            dns.restore().unwrap();
            assert!(!dns.is_active());
        }

        #[test]
        fn failed_apply_does_not_claim_dns_active() {
            let (manager, _fake, _dir) = enforce_manager(Capabilities::new(BackendKind::Fake));
            let dns = DnsController::wrap(manager, "tunnet0").unwrap();
            let err = dns
                .apply("tunnet0", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .expect_err("backend without DNS scopes must fail");
            assert!(matches!(err, osdns::Error::Unsupported { .. }));
            assert!(!dns.is_active());
        }

        #[test]
        fn fresh_state_recovery_is_empty_and_safe() {
            let (manager, _fake, _dir) = enforce_manager(full_caps());
            let outcomes = manager.recover_stale().unwrap();
            assert!(outcomes.is_empty());
            // A controller can still be built on recovered state.
            let dns = DnsController::wrap(manager, "tunnet0").unwrap();
            assert!(!dns.is_active());
        }

        #[test]
        fn global_fallback_lifecycle_on_restricted_backend() {
            let caps = Capabilities::new(BackendKind::Fake)
                .with_read(true)
                .with_global_dns(true);
            let (manager, _fake, _dir) = enforce_manager(caps);
            let dns = DnsController::wrap(manager, "tunnet0").unwrap();
            dns.apply("tunnet0", Ipv4Addr::new(100, 100, 100, 53), "tunnet")
                .unwrap();
            assert!(dns.is_active());
            dns.restore().unwrap();
            assert!(!dns.is_active());
        }

        #[test]
        fn verification_failure_does_not_claim_dns_active() {
            let (manager, fake, _dir) = enforce_manager(full_caps());
            let dns = DnsController::wrap(manager, "eth0").unwrap();
            // Simulate an OS whose read-back disagrees with what was applied.
            fake.lie_once_on_readback(FakeState::Empty);
            let err = dns
                .apply("eth0", MAGIC_IP, "tunnet")
                .expect_err("read-back mismatch must fail");
            assert!(matches!(err, osdns::Error::VerificationFailed { .. }));
            assert!(!dns.is_active());
        }

        #[test]
        fn enforce_reconciles_external_change_and_restores_to_new_base() {
            use osdns::testing::DebugReconcile;

            let (manager, fake, _dir) = enforce_manager(full_caps());
            let probe = manager.clone();
            let dns = DnsController::wrap(manager, "eth0").unwrap();
            dns.apply("eth0", MAGIC_IP, "tunnet").unwrap();

            // An external actor (DHCP, admin, another VPN) rewrites our resource.
            fake.external_change("fake:interface:1", foreign_state())
                .unwrap();
            let outcome = probe.debug_reconcile("fake:interface:1").unwrap();
            assert_eq!(outcome, DebugReconcile::Rebased);

            // The Tunnet overlay is reapplied on top of the new external base.
            let current = fake
                .current_state("fake:interface:1")
                .unwrap()
                .expect("resource exists");
            assert!(
                matches!(&current, FakeState::Configured { nameservers, .. }
                    if nameservers.contains(&IpAddr::V4(MAGIC_IP))),
                "overlay must be reapplied, got {current:?}"
            );

            // Restoring a rebased lease returns to the NEW external base,
            // not the stale pre-lease state.
            dns.restore().unwrap();
            let restored = fake
                .current_state("fake:interface:1")
                .unwrap()
                .expect("resource exists");
            assert!(
                matches!(&restored, FakeState::Configured { nameservers, .. }
                    if nameservers == &vec![FOREIGN_IP]),
                "restore must return to the rebased base, got {restored:?}"
            );
            assert!(!dns.is_active());
        }

        #[test]
        fn restore_conflict_abandons_and_preserves_external_state() {
            use osdns::testing::manager_for_testing;

            // Cooperative policy: no background reconciliation races this
            // test; the external modification must survive restore verbatim.
            let dir = tempfile::tempdir().unwrap();
            let fake = FakeDns::with_capabilities(full_caps());
            let manager =
                manager_for_testing("io.tunnet.agent", dir.path(), &fake, Duration::from_secs(5))
                    .unwrap();
            let dns = DnsController::wrap(manager, "eth0").unwrap();
            dns.apply("eth0", MAGIC_IP, "tunnet").unwrap();

            fake.external_change("fake:interface:1", foreign_state())
                .unwrap();
            // No reconciliation pass runs: restore must not overwrite the
            // foreign state. The conflicted lease is abandoned instead.
            dns.restore().unwrap();
            let current = fake
                .current_state("fake:interface:1")
                .unwrap()
                .expect("resource exists");
            assert_eq!(current, foreign_state());
            assert!(!dns.is_active());
        }

        #[test]
        fn crash_between_prepare_and_apply_clears_journal_only() {
            use osdns::testing::{CrashOutcome, FaultInjector, TxPoint, catch_crash};

            let (manager, fake, _dir) = enforce_manager(full_caps());
            let injector = FaultInjector::new();
            injector.crash_at(TxPoint::AfterPrepared);
            manager.install_fault_injector(injector.clone());

            let outcome = catch_crash(|| manager.apply(&global_config()));
            assert!(matches!(outcome, CrashOutcome::Crashed));
            injector.clear();

            // The transaction never became effective: only the journal record
            // is removed, the system is untouched.
            let outcomes = manager.recover_stale().unwrap();
            assert!(
                outcomes
                    .iter()
                    .any(|o| matches!(o, RecoveryOutcome::JournalCleared { .. })),
                "expected journal-only cleanup, got {outcomes:?}"
            );
            assert_eq!(
                fake.current_state("fake:global").unwrap(),
                Some(FakeState::Empty)
            );
        }

        #[test]
        fn crash_after_apply_restores_original_state() {
            use osdns::testing::{CrashOutcome, FaultInjector, TxPoint, catch_crash};

            let (manager, fake, _dir) = enforce_manager(full_caps());
            let injector = FaultInjector::new();
            injector.crash_at(TxPoint::AfterApplied);
            manager.install_fault_injector(injector.clone());

            let outcome = catch_crash(|| manager.apply(&global_config()));
            assert!(matches!(outcome, CrashOutcome::Crashed));
            injector.clear();

            // The overlay was effective at crash time...
            assert!(matches!(
                fake.current_state("fake:global").unwrap(),
                Some(FakeState::Configured { .. })
            ));
            // ...so recovery restores the original state.
            let outcomes = manager.recover_stale().unwrap();
            assert!(
                outcomes
                    .iter()
                    .any(|o| matches!(o, RecoveryOutcome::Restored { .. })),
                "expected restoration, got {outcomes:?}"
            );
            assert_eq!(
                fake.current_state("fake:global").unwrap(),
                Some(FakeState::Empty)
            );
        }

        #[test]
        fn recovery_reports_external_conflict_and_touches_nothing() {
            use osdns::testing::{CrashOutcome, FaultInjector, TxPoint, catch_crash};

            let (manager, fake, _dir) = enforce_manager(full_caps());
            let injector = FaultInjector::new();
            injector.crash_at(TxPoint::AfterApplied);
            manager.install_fault_injector(injector.clone());
            let outcome = catch_crash(|| manager.apply(&global_config()));
            assert!(matches!(outcome, CrashOutcome::Crashed));
            injector.clear();

            // Another actor changed the resource before recovery ran.
            fake.external_change("fake:global", foreign_state())
                .unwrap();
            let outcomes = manager.recover_stale().unwrap();
            assert!(
                outcomes
                    .iter()
                    .any(|o| matches!(o, RecoveryOutcome::ExternalConflict { .. })),
                "expected external conflict, got {outcomes:?}"
            );
            // Ownership is never guessed: the foreign state is left alone.
            assert_eq!(
                fake.current_state("fake:global").unwrap(),
                Some(foreign_state())
            );
        }

        #[test]
        fn locked_resource_reports_busy() {
            use osdns::testing::manager_for_testing_with_policy;

            let dir = tempfile::tempdir().unwrap();
            let fake = FakeDns::with_capabilities(full_caps());
            let crashed = manager_for_testing_with_policy(
                "io.tunnet.test-a",
                dir.path(),
                &fake,
                Duration::from_secs(5),
                ConflictPolicy::Enforce,
            )
            .unwrap();
            // Leave a stale journal record behind via a simulated crash.
            {
                use osdns::testing::{CrashOutcome, FaultInjector, TxPoint, catch_crash};
                let injector = FaultInjector::new();
                injector.crash_at(TxPoint::AfterApplied);
                crashed.install_fault_injector(injector.clone());
                let outcome = catch_crash(|| crashed.apply(&global_config()));
                assert!(matches!(outcome, CrashOutcome::Crashed));
            }
            // Another live lease now owns the resource...
            let holder = manager_for_testing_with_policy(
                "io.tunnet.test-b",
                dir.path(),
                &fake,
                Duration::from_secs(5),
                ConflictPolicy::Enforce,
            )
            .unwrap();
            let _lease = holder.apply(&global_config()).unwrap();
            // ...so recovery skips it instead of fighting the owner.
            let inspector = manager_for_testing_with_policy(
                "io.tunnet.test-c",
                dir.path(),
                &fake,
                Duration::from_secs(5),
                ConflictPolicy::Enforce,
            )
            .unwrap();
            let outcomes = inspector.recover_stale().unwrap();
            assert!(
                outcomes
                    .iter()
                    .any(|o| matches!(o, RecoveryOutcome::Busy { .. })),
                "expected busy resource, got {outcomes:?}"
            );
        }

        #[test]
        fn corrupt_journal_fails_closed() {
            let (manager, _fake, dir) = enforce_manager(full_caps());
            let journal_dir = dir.path().join("journal");
            std::fs::create_dir_all(&journal_dir).unwrap();
            std::fs::write(journal_dir.join("bogus.json"), b"{ not valid json").unwrap();
            let err = manager
                .recover_stale()
                .expect_err("corrupt journal must fail closed");
            assert!(matches!(err, osdns::Error::JournalCorrupt(_)));
        }

        const MAGIC_IP: Ipv4Addr = Ipv4Addr::new(100, 100, 100, 53);
        const FOREIGN_IP: IpAddr = IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9));

        fn foreign_state() -> FakeState {
            FakeState::Configured {
                nameservers: vec![FOREIGN_IP],
                search_domains: vec![],
                routing_domains: vec![],
                default_route: None,
            }
        }

        fn global_config() -> DnsConfig {
            DnsConfig::builder(DnsScope::Global)
                .nameserver(IpAddr::V4(MAGIC_IP))
                .build()
                .unwrap()
        }
    }
}
