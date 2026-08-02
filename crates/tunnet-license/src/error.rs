use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseFailureCode {
    NotConfigured,
    SourceUnavailable,
    TooLarge,
    Malformed,
    UnsupportedFormat,
    UnknownKey,
    KeyRevoked,
    AlgMismatch,
    BadSignature,
    UnsupportedClaim,
    InvalidClaims,
    IssuerMismatch,
    AudienceMismatch,
    NotYetValid,
    Expired,
    Revoked,
    ClockRollback,
}

impl LicenseFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::SourceUnavailable => "source_unavailable",
            Self::TooLarge => "too_large",
            Self::Malformed => "malformed",
            Self::UnsupportedFormat => "unsupported_format",
            Self::UnknownKey => "unknown_key",
            Self::KeyRevoked => "key_revoked",
            Self::AlgMismatch => "alg_mismatch",
            Self::BadSignature => "bad_signature",
            Self::UnsupportedClaim => "unsupported_claim",
            Self::InvalidClaims => "invalid_claims",
            Self::IssuerMismatch => "issuer_mismatch",
            Self::AudienceMismatch => "audience_mismatch",
            Self::NotYetValid => "not_yet_valid",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
            Self::ClockRollback => "clock_rollback",
        }
    }
}

impl std::fmt::Display for LicenseFailureCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Verifier / loader error carrying a failure code and human message.
#[derive(Debug, Error, Clone)]
#[error("{message}")]
pub struct LicenseError {
    pub code: LicenseFailureCode,
    pub message: String,
}

impl LicenseError {
    pub fn new(code: LicenseFailureCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn too_large(message: impl Into<String>) -> Self {
        Self::new(LicenseFailureCode::TooLarge, message)
    }

    pub fn malformed(message: impl Into<String>) -> Self {
        Self::new(LicenseFailureCode::Malformed, message)
    }

    pub fn unsupported_format(message: impl Into<String>) -> Self {
        Self::new(LicenseFailureCode::UnsupportedFormat, message)
    }
}
