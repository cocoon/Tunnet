use ipnet::IpNet;
use tunnet_common::policy::Selector;

use crate::error::{PolicyError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedSelector {
    Any,
    Endpoint(String),
    Tag(String),
    Cidr(IpNet),
    User(String),
    HostAlias(String),
    IpSet(String),
}

pub fn parse_selector(raw: &str) -> Result<ParsedSelector> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(PolicyError::Parse("empty selector".into()));
    }
    if s == "*" {
        return Ok(ParsedSelector::Any);
    }
    if s.starts_with("group:user:") || s.starts_with("group:device:") {
        return Err(PolicyError::Parse(format!(
            "invalid selector syntax: {s} (group selectors are no longer supported; use tag:)"
        )));
    }
    if let Some(rest) = s.strip_prefix("tag:") {
        return Ok(ParsedSelector::Tag(rest.to_string()));
    }
    if let Some(rest) = s.strip_prefix("user:") {
        return Ok(ParsedSelector::User(rest.to_string()));
    }
    if let Some(rest) = s.strip_prefix("host:") {
        return Ok(ParsedSelector::HostAlias(rest.to_string()));
    }
    if let Some(rest) = s.strip_prefix("ipset:") {
        return Ok(ParsedSelector::IpSet(rest.to_string()));
    }
    if let Ok(net) = s.parse::<IpNet>() {
        return Ok(ParsedSelector::Cidr(net));
    }
    if is_endpoint_hex(s) {
        return Ok(ParsedSelector::Endpoint(s.to_string()));
    }
    Err(PolicyError::Parse(format!("invalid selector syntax: {s}")))
}

pub fn to_policy_selector(parsed: &ParsedSelector) -> Selector {
    match parsed {
        ParsedSelector::Any => Selector::Any,
        ParsedSelector::Endpoint(id) => Selector::Endpoint(id.clone()),
        ParsedSelector::Tag(name) => Selector::Tag(name.clone()),
        ParsedSelector::Cidr(net) => Selector::Cidr(*net),
        ParsedSelector::User(id) => Selector::User(id.clone()),
        ParsedSelector::HostAlias(name) => Selector::Tag(format!("host:{name}")),
        ParsedSelector::IpSet(name) => Selector::Tag(format!("ipset:{name}")),
    }
}

pub fn simulation_tags(parsed: &ParsedSelector) -> Vec<String> {
    match parsed {
        ParsedSelector::Any => vec![],
        ParsedSelector::Endpoint(_) => vec![],
        ParsedSelector::Tag(name) => vec![name.clone()],
        ParsedSelector::Cidr(_) => vec![],
        ParsedSelector::User(id) => vec![format!("user:{id}"), id.clone()],
        ParsedSelector::HostAlias(name) => vec![format!("host:{name}")],
        ParsedSelector::IpSet(name) => vec![format!("ipset:{name}")],
    }
}

pub fn simulation_endpoint(parsed: &ParsedSelector) -> Option<String> {
    match parsed {
        ParsedSelector::Endpoint(id) => Some(id.clone()),
        _ => None,
    }
}

fn is_endpoint_hex(s: &str) -> bool {
    s.len() >= 16 && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    #[case::any("*", ParsedSelector::Any)]
    #[case::tag("tag:prod", ParsedSelector::Tag("prod".into()))]
    #[case::user("user:alice", ParsedSelector::User("alice".into()))]
    #[case::host("host:db", ParsedSelector::HostAlias("db".into()))]
    #[case::ip_set("ipset:office", ParsedSelector::IpSet("office".into()))]
    #[case::ipv4_cidr("10.0.0.0/8", ParsedSelector::Cidr("10.0.0.0/8".parse().unwrap()))]
    #[case::ipv6_cidr("fd00::/8", ParsedSelector::Cidr("fd00::/8".parse().unwrap()))]
    #[case::endpoint("0123456789abcdef", ParsedSelector::Endpoint("0123456789abcdef".into()))]
    fn parses_supported_selectors(#[case] raw: &str, #[case] expected: ParsedSelector) {
        assert_eq!(parse_selector(raw).unwrap(), expected);
    }

    #[rstest]
    #[case::empty("")]
    #[case::whitespace("  ")]
    #[case::legacy_user_group("group:user:eng")]
    #[case::legacy_device_group("group:device:servers")]
    #[case::invalid_cidr("10.0.0.0/99")]
    #[case::short_endpoint("deadbeef")]
    #[case::unknown_prefix("role:admin")]
    fn rejects_invalid_or_legacy_selectors(#[case] raw: &str) {
        let err = parse_selector(raw).unwrap_err();
        assert!(err.to_string().contains(raw.trim()));
    }
}
