//! License tiers, features, limits, and entitlement snapshots.

use serde::{Deserialize, Serialize};

use crate::error::LicenseFailureCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicenseTier {
    Community,
    Cloud,
    Enterprise,
}

impl LicenseTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Community => "community",
            Self::Cloud => "cloud",
            Self::Enterprise => "enterprise",
        }
    }

    pub fn is_paid(self) -> bool {
        matches!(self, Self::Cloud | Self::Enterprise)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    MultiOrganization,
    CloudLanding,
    CloudInfrastructure,
    OpenSignUp,
    ClickhouseAudit,
    AuditEnterpriseStreams,
    ComplianceExport,
}

impl Feature {
    pub const ALL: &[Feature] = &[
        Self::MultiOrganization,
        Self::CloudLanding,
        Self::CloudInfrastructure,
        Self::OpenSignUp,
        Self::ClickhouseAudit,
        Self::AuditEnterpriseStreams,
        Self::ComplianceExport,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::MultiOrganization => "multiOrganization",
            Self::CloudLanding => "cloudLanding",
            Self::CloudInfrastructure => "cloudInfrastructure",
            Self::OpenSignUp => "openSignUp",
            Self::ClickhouseAudit => "clickhouseAudit",
            Self::AuditEnterpriseStreams => "auditEnterpriseStreams",
            Self::ComplianceExport => "complianceExport",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Limit {
    Organizations,
    Nodes,
    Seats,
    Relays,
}

impl Limit {
    pub const ALL: &[Limit] = &[Self::Organizations, Self::Nodes, Self::Seats, Self::Relays];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Organizations => "organizations",
            Self::Nodes => "nodes",
            Self::Seats => "seats",
            Self::Relays => "relays",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicenseStatus {
    Community,
    Active,
    Grace,
    Expired,
}

/// Feature flags (wire: camelCase).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeatureMap {
    pub multi_organization: bool,
    pub cloud_landing: bool,
    pub cloud_infrastructure: bool,
    pub open_sign_up: bool,
    pub clickhouse_audit: bool,
    pub audit_enterprise_streams: bool,
    pub compliance_export: bool,
}

impl FeatureMap {
    pub fn all_off() -> Self {
        Self::default()
    }

    pub fn get(self, feature: Feature) -> bool {
        match feature {
            Feature::MultiOrganization => self.multi_organization,
            Feature::CloudLanding => self.cloud_landing,
            Feature::CloudInfrastructure => self.cloud_infrastructure,
            Feature::OpenSignUp => self.open_sign_up,
            Feature::ClickhouseAudit => self.clickhouse_audit,
            Feature::AuditEnterpriseStreams => self.audit_enterprise_streams,
            Feature::ComplianceExport => self.compliance_export,
        }
    }

    pub fn set(&mut self, feature: Feature, on: bool) {
        match feature {
            Feature::MultiOrganization => self.multi_organization = on,
            Feature::CloudLanding => self.cloud_landing = on,
            Feature::CloudInfrastructure => self.cloud_infrastructure = on,
            Feature::OpenSignUp => self.open_sign_up = on,
            Feature::ClickhouseAudit => self.clickhouse_audit = on,
            Feature::AuditEnterpriseStreams => self.audit_enterprise_streams = on,
            Feature::ComplianceExport => self.compliance_export = on,
        }
    }

    pub fn from_enabled(on: &[Feature]) -> Self {
        let mut m = Self::all_off();
        for f in on {
            m.set(*f, true);
        }
        m
    }
}

/// Resource limits; `None` means unlimited.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitMap {
    pub organizations: Option<i64>,
    pub nodes: Option<i64>,
    pub seats: Option<i64>,
    pub relays: Option<i64>,
}

impl LimitMap {
    pub fn unlimited() -> Self {
        Self {
            organizations: None,
            nodes: None,
            seats: None,
            relays: None,
        }
    }

    pub fn get(self, limit: Limit) -> Option<i64> {
        match limit {
            Limit::Organizations => self.organizations,
            Limit::Nodes => self.nodes,
            Limit::Seats => self.seats,
            Limit::Relays => self.relays,
        }
    }
}

/// Nested entitlements snapshot matching `@tunnet/license` `features.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub status: LicenseStatus,
    pub tier: LicenseTier,
    pub features: FeatureMap,
    pub limits: LimitMap,
    pub license_id: Option<String>,
    pub subject: Option<String>,
    pub issued_at: Option<i64>,
    pub not_after: Option<i64>,
    pub grace_until: Option<i64>,
    pub stale: bool,
    pub reason: Option<LicenseFailureCode>,
}

/// Tier → default feature presets (same as TS `TIER_PRESETS`).
pub fn tier_presets(tier: LicenseTier) -> FeatureMap {
    match tier {
        LicenseTier::Community => FeatureMap::all_off(),
        LicenseTier::Cloud => FeatureMap::from_enabled(Feature::ALL),
        LicenseTier::Enterprise => FeatureMap::from_enabled(&[
            Feature::ClickhouseAudit,
            Feature::AuditEnterpriseStreams,
            Feature::ComplianceExport,
        ]),
    }
}

pub fn community() -> Entitlements {
    Entitlements {
        status: LicenseStatus::Community,
        tier: LicenseTier::Community,
        features: tier_presets(LicenseTier::Community),
        limits: LimitMap {
            organizations: Some(1),
            nodes: None,
            seats: None,
            relays: None,
        },
        license_id: None,
        subject: None,
        issued_at: None,
        not_after: None,
        grace_until: None,
        stale: false,
        reason: None,
    }
}

pub fn community_with_reason(reason: Option<LicenseFailureCode>, stale: bool) -> Entitlements {
    Entitlements {
        reason,
        stale,
        ..community()
    }
}
