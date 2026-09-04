//! Established-peer fast state (§0.5).
//!
//! One stable `PeerFastState` per peer carries everything the established
//! packet path needs, so after routing there are no map lookups, no async
//! mutexes, and no string conversions:
//!
//! ```text
//! PeerFastState
//!   identity: peer identity/context (RwLock<Arc<..>>, updated on rebuild)
//!   conn: live QUIC Connection (ArcSwapOption, lock-free)
//!   scheduler: per-peer FQ-CoDel state (Mutex, pump-owned in practice)
//!   policy: resolved firewall set + counters + generation (ArcSwap)
//!   tx/rx counters, coarse activity, relay flag, effective MPS, RTT cache
//!   reassembly table, frame-ID counter, pump wakeup
//! ```
//!
//! The registry (`PeerRegistry`, a DashMap) is touched only on slow paths:
//! creation, reconnect, teardown, policy relink, heartbeats. Routing hands
//! out `Arc<PeerFastState>` clones embedded in peer handles; inbound readers
//! resolve once per connection.

use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

use arc_swap::{ArcSwap, ArcSwapOption};
use dashmap::DashMap;
use iroh::EndpointId;
use iroh::endpoint::Connection;
use parking_lot::{Mutex, RwLock};
use tokio::sync::Notify;
use uuid::Uuid;

use crate::policy_runtime::{FwCounters, FwSet, PolicyRuntime};
use crate::reassembly::ReassemblyTable;
use crate::scheduler::PeerScheduler;

/// Immutable peer identity/context for the fast path.
#[derive(Debug, Clone)]
pub struct PeerIdentity {
    pub endpoint: EndpointId,
    pub endpoint_hex: String,
    pub hostname: String,
    pub ip: Ipv4Addr,
    pub tags: Vec<String>,
    pub network_id: Uuid,
    pub network_name: String,
}

/// Resolved policy link for a peer (swapped atomically on publish).
#[derive(Debug, Clone)]
pub struct PeerPolicyLink {
    pub fw: Arc<FwSet>,
    pub counters: Arc<FwCounters>,
    pub generation: u64,
}

impl Default for PeerPolicyLink {
    fn default() -> Self {
        Self {
            fw: Arc::new(FwSet::default()),
            counters: Arc::new(FwCounters::default()),
            generation: 0,
        }
    }
}

/// Default DRR quantum: one logical MTU-ish chunk (retuned with MPS).
pub const DEFAULT_QUANTUM: usize = 1536;
/// Default effective DATAGRAM payload before the first measurement.
pub const DEFAULT_MPS: usize = 1280;

pub struct PeerFastState {
    pub identity: RwLock<Arc<PeerIdentity>>,
    pub conn: ArcSwapOption<Connection>,
    pub scheduler: Mutex<PeerScheduler>,
    pub policy: ArcSwap<PeerPolicyLink>,
    pub reassembly: Mutex<ReassemblyTable>,
    pub notify: Notify,
    pub pump_running: AtomicBool,
    pub tx_packets: AtomicU64,
    pub tx_bytes: AtomicU64,
    pub rx_packets: AtomicU64,
    pub rx_bytes: AtomicU64,
    pub last_activity_ms: AtomicU64,
    pub relay: AtomicBool,
    /// Effective DATAGRAM payload size (frame bytes), adapted to path MTU.
    pub mps: AtomicUsize,
    /// Cached RTT millis for adaptive backoff (updated by path watcher).
    pub rtt_ms: AtomicU64,
    pub next_frame_id: AtomicU32,
    /// Sends since the last MPS refresh (periodic re-measurement).
    pub sends_since_mps_check: AtomicU64,
    /// Ownership epoch: bumped when the connection is torn down without
    /// replacement (dataplane down, peer drop). Pumps observe it and exit
    /// instead of parking forever on a dead generation.
    pub epoch: AtomicU64,
}

impl PeerFastState {
    pub fn new(identity: Arc<PeerIdentity>, reassembly_budget: Arc<AtomicU64>) -> Arc<Self> {
        Arc::new(Self {
            identity: RwLock::new(identity),
            conn: ArcSwapOption::empty(),
            scheduler: Mutex::new(PeerScheduler::new(DEFAULT_QUANTUM)),
            policy: ArcSwap::from_pointee(PeerPolicyLink::default()),
            reassembly: Mutex::new(ReassemblyTable::new(reassembly_budget)),
            notify: Notify::new(),
            pump_running: AtomicBool::new(false),
            tx_packets: AtomicU64::new(0),
            tx_bytes: AtomicU64::new(0),
            rx_packets: AtomicU64::new(0),
            rx_bytes: AtomicU64::new(0),
            last_activity_ms: AtomicU64::new(now_millis()),
            relay: AtomicBool::new(false),
            mps: AtomicUsize::new(DEFAULT_MPS),
            rtt_ms: AtomicU64::new(90),
            next_frame_id: AtomicU32::new(rand::random()),
            sends_since_mps_check: AtomicU64::new(0),
            epoch: AtomicU64::new(0),
        })
    }

    /// Non-blocking DATAGRAM submit with Model A ownership (§0.6): submit
    /// only when the reported free space fits the ENTIRE frame, so QUIC never
    /// silently displaces an older buffered datagram behind our back.
    ///
    /// The frame is returned on every error path, so the pump can requeue or
    /// resume losslessly — a stall never consumes bytes.
    pub fn try_send_frame(&self, frame: bytes::Bytes) -> Result<(), (FastSendError, bytes::Bytes)> {
        let frame_len = frame.len();
        let Some(conn) = self.conn.load_full() else {
            return Err((FastSendError::NoConnection, frame));
        };
        if conn.close_reason().is_some() {
            self.conn.store(None);
            return Err((FastSendError::NoConnection, frame));
        }
        if let Some(max) = conn.max_datagram_size()
            && frame_len > max
        {
            return Err((FastSendError::TooLarge, frame));
        }
        if conn.datagram_send_buffer_space() < frame_len {
            return Err((FastSendError::TransportFull, frame));
        }
        match conn.send_datagram(frame) {
            Ok(()) => {
                self.tx_packets.fetch_add(1, Ordering::Relaxed);
                self.tx_bytes.fetch_add(frame_len as u64, Ordering::Relaxed);
                self.touch();
                Ok(())
            }
            Err(_) => Err((FastSendError::Closed, bytes::Bytes::new())),
        }
    }

    /// Refresh the cached MPS from the live connection (slow-ish: locks the
    /// QUIC connection state; called periodically, not per packet).
    pub fn refresh_mps(&self) -> Option<usize> {
        let conn = self.conn.load_full()?;
        let mps = conn.max_datagram_size()?;
        self.mps.store(mps, Ordering::Relaxed);
        // Sample RTT from the selected path for adaptive backoff.
        if let Some(rtt) = conn
            .paths()
            .iter()
            .find(|p| p.is_selected())
            .map(|p| p.stats().rtt)
        {
            self.rtt_ms.store(
                rtt.as_millis().min(u128::from(u64::MAX)) as u64,
                Ordering::Relaxed,
            );
        }
        // Scale the DRR quantum with the effective payload: one logical
        // MTU-ish chunk keeps DRR fair as paths change.
        self.scheduler.lock().set_quantum(mps.max(512));
        Some(mps)
    }

    pub fn live_conn(&self) -> Option<Connection> {
        let conn = self.conn.load_full()?;
        if conn.close_reason().is_some() {
            return None;
        }
        Some(conn.as_ref().clone())
    }

    pub fn touch(&self) {
        let now = now_millis();
        let last = self.last_activity_ms.load(Ordering::Relaxed);
        if now.wrapping_sub(last) >= 1000 {
            self.last_activity_ms.store(now, Ordering::Relaxed);
        }
    }

    pub fn record_rx(&self, n: u64) {
        self.rx_packets.fetch_add(1, Ordering::Relaxed);
        self.rx_bytes.fetch_add(n, Ordering::Relaxed);
        self.touch();
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastSendError {
    /// No live connection: caller must take the slow reconnect path.
    NoConnection,
    /// QUIC DATAGRAM buffer full: scheduler owns the drop/retry decision.
    TransportFull,
    TooLarge,
    Closed,
}

impl std::fmt::Display for FastSendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoConnection => write!(f, "no live connection"),
            Self::TransportFull => write!(f, "transport buffer full"),
            Self::TooLarge => write!(f, "datagram_too_large"),
            Self::Closed => write!(f, "connection closed"),
        }
    }
}

impl std::error::Error for FastSendError {}

/// Slow-path-only registry. Packet paths never touch this map: routing
/// embeds `Arc<PeerFastState>` in peer handles and inbound readers cache one
/// `Arc` per connection.
#[derive(Clone, Default)]
pub struct PeerRegistry {
    states: Arc<DashMap<EndpointId, Arc<PeerFastState>>>,
    reassembly_budget: Arc<AtomicU64>,
}

impl PeerRegistry {
    pub fn new() -> Self {
        Self {
            states: Arc::new(DashMap::new()),
            reassembly_budget: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Shared reassembly byte counter (global cap denominator).
    pub fn reassembly_budget(&self) -> &Arc<AtomicU64> {
        &self.reassembly_budget
    }

    /// Get-or-create (slow path: routing rebuild, adopt, dial).
    pub fn ensure(&self, identity: Arc<PeerIdentity>) -> Arc<PeerFastState> {
        if let Some(existing) = self.states.get(&identity.endpoint) {
            // Refresh identity context in place; the object stays stable.
            *existing.identity.write() = identity;
            return existing.value().clone();
        }
        let state = PeerFastState::new(identity.clone(), self.reassembly_budget.clone());
        self.states
            .entry(identity.endpoint)
            .or_insert(state)
            .clone()
    }

    pub fn get(&self, peer: EndpointId) -> Option<Arc<PeerFastState>> {
        self.states.get(&peer).map(|e| e.value().clone())
    }

    pub fn set_conn(&self, peer: EndpointId, conn: Option<Connection>) {
        if let Some(state) = self.states.get(&peer) {
            match conn {
                Some(c) => {
                    state.conn.store(Some(Arc::new(c.clone())));
                    // Fresh connection: reset pacing state to measured values.
                    state.refresh_mps();
                    state.next_frame_id.store(rand::random(), Ordering::Relaxed);
                    state.sends_since_mps_check.store(0, Ordering::Relaxed);
                }
                None => state.conn.store(None),
            }
        }
    }

    pub fn remove(&self, peer: EndpointId) {
        self.states.remove(&peer);
    }

    /// Retain only live membership (slow path: routing rebuild prunes
    /// departed peers; readers holding Arcs are unaffected).
    pub fn retain(&self, live: &std::collections::HashSet<EndpointId>) {
        self.states.retain(|ep, _| live.contains(ep));
    }

    pub fn clear(&self) {
        self.states.clear();
    }

    /// Proactive policy relink after every publish (slow/control path):
    /// every stable state points at the fresh compiled set, so established
    /// packets never re-resolve and never observe a torn generation.
    pub fn relink_policy(&self, runtime: &PolicyRuntime) {
        let policy_gen = runtime.generation();
        for entry in self.states.iter() {
            let state = entry.value();
            let network = state.identity.read().network_id;
            let link = PeerPolicyLink {
                fw: runtime.fw_for_network(network),
                counters: runtime.fw_counters_for(network),
                generation: policy_gen,
            };
            state.policy.store(Arc::new(link));
        }
    }

    /// Heartbeat aggregates (slow path only).
    pub fn heartbeat_counters(&self) -> (u32, u64, u64) {
        let mut conns = 0u32;
        let mut tx = 0u64;
        let mut rx = 0u64;
        for entry in self.states.iter() {
            let s = entry.value();
            if s.live_conn().is_some() {
                conns += 1;
            }
            tx += s.tx_bytes.load(Ordering::Relaxed);
            rx += s.rx_bytes.load(Ordering::Relaxed);
        }
        (conns, tx, rx)
    }

    pub fn peer_bytes(&self, peer: EndpointId) -> (u64, u64) {
        match self.states.get(&peer) {
            Some(s) => (
                s.rx_bytes.load(Ordering::Relaxed),
                s.tx_bytes.load(Ordering::Relaxed),
            ),
            None => (0, 0),
        }
    }

    /// Adaptive transport-full backoff (§0.7): RTT/4 clamped to
    /// [100µs, 2ms]. No fixed 5 ms stall, no spin, no send_datagram_wait.
    /// New enqueues notify immediately, so this timeout is only the
    /// no-new-work fallback. (A public `datagrams_unblocked` waiter in
    /// Iroh/noq would be the cleaner upstream primitive; investigated,
    /// not available — the internal Notify stays private.)
    pub fn backoff_for(peer: &PeerFastState) -> Duration {
        let rtt_ms = peer.rtt_ms.load(Ordering::Relaxed);
        let micros = rtt_ms.saturating_mul(250).clamp(100, 2000);
        Duration::from_micros(micros)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn test_endpoint() -> EndpointId {
        SecretKey::generate().public()
    }

    fn identity(endpoint: EndpointId) -> Arc<PeerIdentity> {
        Arc::new(PeerIdentity {
            endpoint,
            endpoint_hex: format!("{endpoint}"),
            hostname: "peer".into(),
            ip: std::net::Ipv4Addr::new(10, 0, 0, 2),
            tags: vec![],
            network_id: Uuid::nil(),
            network_name: "net".into(),
        })
    }

    #[test]
    fn registry_reuses_stable_state() {
        let reg = PeerRegistry::new();
        let ep = test_endpoint();
        let a = reg.ensure(identity(ep));
        let b = reg.ensure(identity(ep));
        assert!(Arc::ptr_eq(&a, &b), "same stable object");
        // Identity refresh keeps the object.
        let mut id = identity(ep);
        let idm = Arc::get_mut(&mut id).unwrap();
        idm.hostname = "renamed".into();
        let c = reg.ensure(id);
        assert!(Arc::ptr_eq(&a, &c));
        assert_eq!(c.identity.read().hostname, "renamed");
    }

    #[test]
    fn try_send_without_conn_is_no_connection() {
        let reg = PeerRegistry::new();
        let ep = test_endpoint();
        let s = reg.ensure(identity(ep));
        let err = s
            .try_send_frame(bytes::Bytes::from_static(b"x"))
            .unwrap_err()
            .0;
        assert_eq!(err, FastSendError::NoConnection);
    }

    #[test]
    fn backoff_bounds() {
        let reg = PeerRegistry::new();
        let ep = test_endpoint();
        let s = reg.ensure(identity(ep));
        s.rtt_ms.store(0, Ordering::Relaxed);
        assert_eq!(PeerRegistry::backoff_for(&s), Duration::from_micros(100));
        s.rtt_ms.store(10_000, Ordering::Relaxed);
        assert_eq!(PeerRegistry::backoff_for(&s), Duration::from_micros(2000));
        s.rtt_ms.store(90, Ordering::Relaxed);
        // 90 ms → 22.5 ms raw, clamped to the 2 ms ceiling.
        assert_eq!(PeerRegistry::backoff_for(&s), Duration::from_micros(2000));
        s.rtt_ms.store(4, Ordering::Relaxed);
        // 4 ms → 1 ms raw, inside the band.
        assert_eq!(PeerRegistry::backoff_for(&s), Duration::from_micros(1000));
    }
}
