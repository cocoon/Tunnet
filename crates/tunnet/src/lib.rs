//! # tunnet

mod enroll;
mod error;
mod features;
mod listener;
mod node;
mod peer;
mod stream;
mod types;

#[cfg(feature = "managed")]
pub use enroll::enroll;
pub use enroll::{EnrollConfig, EnrollResult};
pub use error::{Error, Result};
pub use listener::StreamListener;
pub use node::{TunnetNode, TunnetNodeBuilder};
pub use peer::Peer;
pub use stream::TunnetStream;
pub use types::policy;
pub use types::{
    EndpointSnapshot, NetworkMembershipSnapshot, PeerEntry, PolicyBundle, StreamHeader,
};

#[cfg(feature = "serve")]
pub use features::ServeInfo;
#[cfg(feature = "send")]
pub use features::Transfer;
#[cfg(feature = "serve")]
pub use tunnet_core::ServeAcl;

#[cfg(feature = "direct")]
/// Direct / local-first mode helpers and types.
pub mod direct {
    pub use tunnet_core::DirectState;
    pub use tunnet_core::NodeMode;
    pub use tunnet_core::PersistedState;
}
