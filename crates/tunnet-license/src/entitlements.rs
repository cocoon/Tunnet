use crate::error::LicenseFailureCode;
use crate::features::{Entitlements, Feature, LicenseStatus, community_with_reason};
use crate::verify::{License, RuntimeStatus};

pub use crate::features::community;

pub fn entitlements_from(license: &License, status: RuntimeStatus, stale: bool) -> Entitlements {
    let status = match status {
        RuntimeStatus::Active => LicenseStatus::Active,
        RuntimeStatus::Grace => LicenseStatus::Grace,
    };
    Entitlements {
        status,
        tier: license.tier,
        features: license.features,
        limits: license.limits,
        license_id: Some(license.jti.clone()),
        subject: Some(license.sub.clone()),
        issued_at: Some(license.iat),
        not_after: Some(license.exp),
        grace_until: if license.grace > 0 {
            Some(license.exp + license.grace)
        } else {
            None
        },
        stale,
        reason: None,
    }
}

pub fn has_feature(entitlements: &Entitlements, feature: Feature) -> bool {
    entitlements.features.get(feature)
}

pub fn fallback_community(reason: LicenseFailureCode, stale: bool) -> Entitlements {
    community_with_reason(Some(reason), stale)
}
