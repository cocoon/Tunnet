//! AGPL tnlic1 license verification for Tunnet server components.
//!
//! Mirrors `@tunnet/license` (packages/license) token format and verifier semantics.

pub mod entitlements;
pub mod error;
pub mod features;
pub mod keyring;
pub mod resolve;
pub mod token;
pub mod verify;

pub use entitlements::{entitlements_from, has_feature};
pub use error::{LicenseError, LicenseFailureCode};
pub use features::{
    Entitlements, Feature, FeatureMap, LicenseStatus, LicenseTier, Limit, LimitMap, community,
    tier_presets,
};
pub use keyring::{KeyStatus, Keyring, TUNNET_TRUSTED_KEYS, TrustedKey};
pub use resolve::resolve_entitlements_from_env;
pub use token::{DecodedToken, LICENSE_TYP, MAX_TOKEN_LEN, TOKEN_PREFIX, decode_token};
pub use verify::{
    DEFAULT_CLOCK_SKEW_SEC, License, RuntimeStatus, VerifyOptions, VerifyResult,
    deployment_fingerprint, verify_license_token,
};
