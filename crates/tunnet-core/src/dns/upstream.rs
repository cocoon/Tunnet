//! Shared Hickory resolver for names Tunnet does not own.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use hickory_proto::op::ResponseCode;
use hickory_proto::rr::{Name, Record, RecordType};
use hickory_resolver::config::{ResolveHosts, ResolverOpts, ServerOrderingStrategy};
use hickory_resolver::net::NetError;
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::{Resolver, TokioResolver};
use tunnet_common::DnsConfig;

use super::nameserver::{UpstreamSource, parse_upstream};

pub enum ExternalAnswer {
    Records(Vec<Record>),
    NxDomain,
    NoData,
    ServFail,
}

pub type ExtLookupFut<'a> = Pin<Box<dyn Future<Output = ExternalAnswer> + Send + 'a>>;

pub trait ExternalLookup: Send + Sync {
    fn lookup(&self, name: Name, qtype: RecordType) -> ExtLookupFut<'_>;
}

pub struct HickoryLookup {
    resolver: TokioResolver,
}

impl HickoryLookup {
    pub fn from_dns_config(dns: &DnsConfig) -> anyhow::Result<Self> {
        Ok(Self {
            resolver: build_resolver(dns)?,
        })
    }
}

impl ExternalLookup for HickoryLookup {
    fn lookup(&self, name: Name, qtype: RecordType) -> ExtLookupFut<'_> {
        Box::pin(async move {
            match self.resolver.lookup(name, qtype).await {
                Ok(lookup) => {
                    let msg = lookup.message();
                    let mut records = Vec::new();
                    records.extend(msg.answers.iter().cloned());
                    records.extend(msg.authorities.iter().cloned());
                    records.extend(msg.additionals.iter().cloned());
                    if records.is_empty() {
                        ExternalAnswer::NoData
                    } else {
                        ExternalAnswer::Records(records)
                    }
                }
                Err(err) => map_resolve_error(&err),
            }
        })
    }
}

fn ensure_rustls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

pub fn build_resolver(dns: &DnsConfig) -> anyhow::Result<TokioResolver> {
    ensure_rustls();
    match parse_upstream(&dns.upstream)? {
        UpstreamSource::System => {
            let mut builder = TokioResolver::builder_tokio()
                .map_err(|e| anyhow::anyhow!("system DNS configuration: {e}"))?;
            apply_tunnet_opts(builder.options_mut(), dns.dnssec);
            builder
                .build()
                .map_err(|e| anyhow::anyhow!("build system resolver: {e}"))
        }
        UpstreamSource::Config(config) => {
            let mut builder =
                Resolver::builder_with_config(config, TokioRuntimeProvider::default());
            apply_tunnet_opts(builder.options_mut(), dns.dnssec);
            builder
                .build()
                .map_err(|e| anyhow::anyhow!("build resolver: {e}"))
        }
    }
}

/// Options Hickory should use for the local stub proxy.
///
/// DNSSEC `validate` follows `DnsConfig.dnssec`. Hickory itself defaults to
/// off; we keep that unless the operator opts in, because a validating stub
/// in front of a non-validating forwarder (or a broken middlebox) SERVFAILs
/// signed zones that would otherwise resolve.
pub fn tunnet_resolver_opts(dnssec: bool) -> ResolverOpts {
    let mut opts = ResolverOpts::default();
    apply_tunnet_opts(&mut opts, dnssec);
    opts
}

fn apply_tunnet_opts(opts: &mut ResolverOpts, dnssec: bool) {
    opts.edns0 = true;
    opts.try_tcp_on_error = true;
    opts.preserve_intermediates = true;
    opts.recursion_desired = true;
    opts.num_concurrent_reqs = 2;
    opts.max_active_requests = 32;
    opts.cache_size = 32;
    opts.attempts = 2;
    opts.timeout = Duration::from_secs(5);
    opts.use_hosts_file = ResolveHosts::Auto;
    opts.server_ordering_strategy = ServerOrderingStrategy::QueryStatistics;
    opts.validate = dnssec;
}

fn map_resolve_error(err: &NetError) -> ExternalAnswer {
    if err.is_nx_domain() {
        return ExternalAnswer::NxDomain;
    }
    if err.is_no_records_found() {
        return ExternalAnswer::NoData;
    }
    tracing::debug!(error = %err, "hickory lookup failed");
    ExternalAnswer::ServFail
}

pub fn map_external(answer: ExternalAnswer) -> (ResponseCode, Vec<Record>) {
    match answer {
        ExternalAnswer::Records(records) => (ResponseCode::NoError, records),
        ExternalAnswer::NxDomain => (ResponseCode::NXDomain, Vec::new()),
        ExternalAnswer::NoData => (ResponseCode::NoError, Vec::new()),
        ExternalAnswer::ServFail => (ResponseCode::ServFail, Vec::new()),
    }
}
