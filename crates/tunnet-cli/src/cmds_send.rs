//! `tunnet send` CLI - P2P file transfer over the mesh.

use anyhow::Context;
use clap::{Args, Subcommand};
use tunnet_client::TunnetClient;
use tunnet_common::local_api::{
    SendConfigInfo, SendFileRequest, SendSetConfigRequest, TransferInfo,
};

use crate::output::Output;

#[derive(Args, Debug)]
pub struct SendArgs {
    #[command(subcommand)]
    pub command: Option<SendCommand>,
    /// Path to send (when not using a subcommand).
    pub path: Option<String>,
    /// Target hostname, mesh IP, endpoint id, or `tag:name`.
    pub target: Option<String>,
    #[arg(short, long)]
    pub message: Option<String>,
    #[arg(long)]
    pub json: bool,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

#[derive(Subcommand, Debug)]
pub enum SendCommand {
    /// Accept a pending inbound offer
    Accept(TransferIdArgs),
    /// Reject a pending inbound offer
    Reject(RejectArgs),
    /// List active / pending transfers
    List(ListArgs),
    /// Completed / failed / rejected history
    History(ListArgs),
    /// Show or update consent mode and inbox path
    Config(ConfigArgs),
}

#[derive(Args, Debug)]
pub struct TransferIdArgs {
    pub transfer_id: String,
    #[arg(long)]
    pub json: bool,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

#[derive(Args, Debug)]
pub struct RejectArgs {
    pub transfer_id: String,
    #[arg(long)]
    pub reason: Option<String>,
    #[arg(long)]
    pub json: bool,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

#[derive(Args, Debug)]
pub struct ListArgs {
    #[arg(long)]
    pub json: bool,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

#[derive(Args, Debug)]
pub struct ConfigArgs {
    /// Consent mode: auto_accept | prompt | deny
    #[arg(long)]
    pub consent: Option<String>,
    #[arg(long)]
    pub inbox: Option<String>,
    #[arg(long)]
    pub pin_blobs: Option<bool>,
    #[arg(long)]
    pub json: bool,
    #[arg(long, env = "TUNNET_STATE_DIR")]
    pub state_dir: Option<String>,
}

pub async fn run(args: SendArgs) -> anyhow::Result<()> {
    match args.command {
        Some(SendCommand::Accept(a)) => {
            let out = Output::new(a.json);
            let client = api_client(&a.state_dir).await?;
            let transfer = client.transfers_accept(&a.transfer_id).await?;
            print_transfer(&out, &transfer)?;
        }
        Some(SendCommand::Reject(a)) => {
            let out = Output::new(a.json);
            let client = api_client(&a.state_dir).await?;
            let resp = client.transfers_reject(&a.transfer_id, a.reason).await?;
            println!("{}", resp.message);
            let _ = out;
        }
        Some(SendCommand::List(a)) => {
            let out = Output::new(a.json);
            let client = api_client(&a.state_dir).await?;
            let resp = client.transfers_list().await?;
            print_transfers(&out, &resp.transfers)?;
        }
        Some(SendCommand::History(a)) => {
            let out = Output::new(a.json);
            let client = api_client(&a.state_dir).await?;
            let resp = client.transfers_history().await?;
            print_transfers(&out, &resp.transfers)?;
        }
        Some(SendCommand::Config(a)) => {
            let out = Output::new(a.json);
            let client = api_client(&a.state_dir).await?;
            let config = if a.consent.is_some() || a.inbox.is_some() || a.pin_blobs.is_some() {
                let body = SendSetConfigRequest {
                    consent: a.consent,
                    inbox_path: a.inbox,
                    pin_blobs: a.pin_blobs,
                };
                client.send_set_config(&body).await?
            } else {
                client.send_config().await?
            };
            print_send_config(&out, &config)?;
        }
        None => {
            let path = args.path.context("usage: tunnet send <path> <target>")?;
            let target = args.target.context("usage: tunnet send <path> <target>")?;
            let out = Output::new(args.json);
            let client = api_client(&args.state_dir).await?;
            let body = SendFileRequest {
                path,
                target,
                message: args.message,
            };
            let resp = client.transfers_send(&body).await?;
            print_transfers(&out, &resp.transfers)?;
        }
    }
    Ok(())
}

async fn api_client(state_dir: &Option<String>) -> anyhow::Result<TunnetClient> {
    crate::cmds::ipc_or_err(state_dir.as_deref()).await
}

fn print_transfers(out: &Output, transfers: &[TransferInfo]) -> anyhow::Result<()> {
    if out.json {
        return out.print_json(transfers);
    }
    if transfers.is_empty() {
        println!("(none)");
        return Ok(());
    }
    for t in transfers {
        let peer = t.peer_hostname.as_deref().unwrap_or(&t.peer_endpoint_id);
        println!(
            "{}\t{}\t{}\t{}\t{:.0}%\t{} → {}\t{}",
            &t.transfer_id[..8.min(t.transfer_id.len())],
            t.direction,
            t.status,
            t.file_name,
            t.percent,
            peer,
            human_size(t.size),
            t.inbox_path.clone().unwrap_or_default()
        );
    }
    Ok(())
}

fn print_transfer(out: &Output, t: &TransferInfo) -> anyhow::Result<()> {
    if out.json {
        return out.print_json(t);
    }
    println!(
        "{} {} {} ({}) {:.0}%",
        t.transfer_id, t.status, t.file_name, t.direction, t.percent
    );
    Ok(())
}

fn print_send_config(out: &Output, c: &SendConfigInfo) -> anyhow::Result<()> {
    if out.json {
        return out.print_json(c);
    }
    println!("consent:    {}", c.consent);
    println!("inbox:      {}", c.inbox_path);
    println!("pin_blobs:  {}", c.pin_blobs);
    Ok(())
}

fn human_size(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}
