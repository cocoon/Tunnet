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

    #[test]
    fn rejects_group_user_selector() {
        let err = parse_selector("group:user:eng").unwrap_err();
        assert!(err.to_string().contains("group:user:eng"));
    }

    #[test]
    fn rejects_group_device_selector() {
        let err = parse_selector("group:device:servers").unwrap_err();
        assert!(err.to_string().contains("group:device:servers"));
    }

    #[test]
    fn parses_cidr_as_ipnet() {
        let p = parse_selector("10.0.0.0/8").unwrap();
        assert!(matches!(p, ParsedSelector::Cidr(_)));
        let Selector::Cidr(net) = to_policy_selector(&p) else {
            panic!("expected Cidr");
        };
        assert!(net.contains(&"10.1.2.3".parse::<std::net::IpAddr>().unwrap()));
    }

    #[test]
    fn invalid_cidr_fails_at_parse() {
        assert!(parse_selector("10.0.0.0/99").is_err());
    }
}
