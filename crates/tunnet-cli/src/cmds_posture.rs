use std::fs;

use anyhow::Context;
use clap::{Args, Subcommand};
use tunnet_common::local_api::PostureCheckRequest;

use crate::cmds::ipc_or_err;
use crate::output::Output;

#[derive(Subcommand, Debug)]
pub enum PostureCommand {
    Status(PostureStatusArgs),
    Check(PostureCheckArgs),
}

#[derive(Args, Debug)]
pub struct PostureStatusArgs {
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PostureCheckArgs {
    #[arg(long)]
    pub file: Option<std::path::PathBuf>,
    #[arg(long)]
    pub json: bool,
}

pub async fn run(command: PostureCommand, state_dir: Option<&str>) -> anyhow::Result<()> {
    match command {
        PostureCommand::Status(args) => run_status(args, state_dir).await,
        PostureCommand::Check(args) => run_check(args, state_dir).await,
    }
}

async fn run_status(args: PostureStatusArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    let out = Output::new(args.json);
    let client = ipc_or_err(state_dir).await?;
    let payload = client.posture_status().await?;
    let data = &payload.data;

    if out.json {
        out.print_json(data)?;
        return Ok(());
    }

    out.writeln(out.bold("Posture attributes"));
    let Some(rows) = data.get("attributes").and_then(|v| v.as_array()) else {
        out.writeln(out.dim("  (none collected)"));
        return Ok(());
    };
    if rows.is_empty() {
        out.writeln(out.dim("  (none collected)"));
        return Ok(());
    }
    for row in rows {
        let key = row.get("attribute").and_then(|v| v.as_str()).unwrap_or("?");
        let value = row
            .get("value")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "?".into());
        out.writeln(format!("  {} = {}", out.cyan(key), value.trim_matches('"')));
    }
    Ok(())
}

async fn run_check(args: PostureCheckArgs, state_dir: Option<&str>) -> anyhow::Result<()> {
    let out = Output::new(args.json);
    let definitions_json = if let Some(path) = args.file {
        Some(fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?)
    } else {
        None
    };
    let client = ipc_or_err(state_dir).await?;
    let payload = client
        .posture_check(&PostureCheckRequest { definitions_json })
        .await?;
    let data = &payload.data;

    if out.json {
        out.print_json(data)?;
        return Ok(());
    }

    out.writeln(out.bold("Posture check"));
    let score = data.get("score").and_then(|v| v.as_u64()).unwrap_or(0);
    let results = data.get("results").and_then(|v| v.as_array());

    if results.map(|r| r.is_empty()).unwrap_or(true) {
        out.writeln(out.dim("  No assertions file - showing score and attributes only."));
        out.writeln(format!("  Score: {}", score_color(&out, score as u32)));
        if let Some(attrs) = data.get("attributes").and_then(|v| v.as_object()) {
            for (k, v) in attrs {
                out.writeln(format!("  {} = {}", out.cyan(k), v));
            }
        }
        return Ok(());
    }

    out.writeln(format!("  Score: {}", score_color(&out, score as u32)));
    if let Some(results) = results {
        for result in results {
            let name = result.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let passed = result
                .get("passed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let status = if passed {
                out.green("pass")
            } else {
                out.red("fail")
            };
            out.writeln(format!("  {} {}", out.cyan(name), status));
            if let Some(fails) = result.get("failing_assertions").and_then(|v| v.as_array()) {
                for fail in fails {
                    let attr = fail
                        .get("attribute")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    let op = fail.get("operator").and_then(|v| v.as_str()).unwrap_or("?");
                    out.writeln(format!("    {}", out.dim(&format!("{attr} {op}"))));
                }
            }
        }
    }
    Ok(())
}

fn score_color(out: &Output, score: u32) -> String {
    if score >= 80 {
        out.green(&score.to_string())
    } else if score >= 50 {
        out.yellow(&score.to_string())
    } else {
        out.red(&score.to_string())
    }
}
