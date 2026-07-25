use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Args, Subcommand};
use tunnet_common::local_api::PolicyOpRequest;

use crate::cmds::ipc_or_err;
use crate::output::Output;

#[derive(Subcommand, Debug)]
pub enum PolicyCommand {
    Validate(PolicyPathArgs),
    Test(PolicyPathArgs),
    Simulate(PolicySimulateArgs),
    Fmt(PolicyPathArgs),
    Export(PolicyExportArgs),
    Diff(PolicyRemotePathArgs),
    Apply(PolicyApplyArgs),
    Drift(PolicyRemotePathArgs),
    History(PolicyHistoryArgs),
    Rollback(PolicyRollbackArgs),
}

#[derive(Args, Debug)]
pub struct PolicyPathArgs {
    pub path: PathBuf,
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicyRemotePathArgs {
    pub path: PathBuf,
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicyApplyArgs {
    pub path: PathBuf,
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub base_revision: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicyHistoryArgs {
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicyRollbackArgs {
    #[arg(long)]
    pub revision_id: String,
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicySimulateArgs {
    pub path: PathBuf,
    #[arg(long)]
    pub from: String,
    #[arg(long)]
    pub to: String,
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug)]
pub struct PolicyExportArgs {
    /// Local policy file for export, or omit for remote export
    pub path: Option<PathBuf>,
    #[arg(long)]
    pub format: Option<String>,
    #[arg(long)]
    pub remote: bool,
    #[arg(long)]
    pub json: bool,
}

pub async fn run(command: PolicyCommand, state_dir: Option<&str>) -> Result<()> {
    match command {
        PolicyCommand::Validate(args) => {
            run_op("validate", &args.path, &args, state_dir, None).await
        }
        PolicyCommand::Test(args) => run_op("test", &args.path, &args, state_dir, None).await,
        PolicyCommand::Simulate(args) => {
            run_op(
                "simulate",
                &args.path,
                &args,
                state_dir,
                Some((&args.from, &args.to)),
            )
            .await
        }
        PolicyCommand::Fmt(args) => run_fmt(args, state_dir).await,
        PolicyCommand::Export(args) => run_export(args, state_dir).await,
        PolicyCommand::Diff(args) => run_op("diff", &args.path, &args, state_dir, None).await,
        PolicyCommand::Apply(args) => run_apply(args, state_dir).await,
        PolicyCommand::Drift(args) => run_op("drift", &args.path, &args, state_dir, None).await,
        PolicyCommand::History(args) => run_history(args, state_dir).await,
        PolicyCommand::Rollback(args) => run_rollback(args, state_dir).await,
    }
}

async fn run_op(
    op: &str,
    path: &PathBuf,
    json_args: &impl PolicyJsonArgs,
    state_dir: Option<&str>,
    simulate: Option<(&str, &str)>,
) -> Result<()> {
    let out = Output::new(json_args.json_flag());
    let (path_contents, path_name) = read_policy_path(path)?;
    let client = ipc_or_err(state_dir).await?;
    let req = PolicyOpRequest {
        op: op.into(),
        path_contents: Some(path_contents),
        path_name: Some(path_name),
        format: None,
        from: simulate.map(|(f, _)| f.to_string()),
        to: simulate.map(|(_, t)| t.to_string()),
        force: None,
        base_revision: None,
        revision_id: None,
        json: json_args.json_flag(),
    };
    let payload = client.policy_op(&req).await?;
    print_policy_result(op, &out, &payload.data)?;
    Ok(())
}

async fn run_fmt(args: PolicyPathArgs, state_dir: Option<&str>) -> Result<()> {
    let out = Output::new(args.json);
    let (path_contents, path_name) = read_policy_path(&args.path)?;
    let client = ipc_or_err(state_dir).await?;
    let req = PolicyOpRequest {
        op: "fmt".into(),
        path_contents: Some(path_contents),
        path_name: Some(path_name),
        format: None,
        from: None,
        to: None,
        force: None,
        base_revision: None,
        revision_id: None,
        json: args.json,
    };
    let payload = client.policy_op(&req).await?;
    let formatted = payload
        .data
        .get("content")
        .and_then(|v| v.as_str())
        .context("missing formatted content")?;
    let out_path = if args.path.is_dir() {
        args.path.join("policy.json")
    } else {
        args.path.clone()
    };
    fs::write(&out_path, formatted).with_context(|| format!("write {}", out_path.display()))?;
    if out.json {
        out.print_json(&payload.data)?;
    } else {
        println!("formatted {}", out_path.display());
    }
    Ok(())
}

async fn run_export(args: PolicyExportArgs, state_dir: Option<&str>) -> Result<()> {
    let out = Output::new(args.json);
    let client = ipc_or_err(state_dir).await?;
    let (path_contents, path_name) = if let Some(path) = &args.path {
        let (contents, name) = read_policy_path(path)?;
        (Some(contents), Some(name))
    } else if args.remote {
        (None, None)
    } else {
        bail!("provide a policy path or --remote");
    };
    let req = PolicyOpRequest {
        op: "export".into(),
        path_contents,
        path_name,
        format: args.format,
        from: None,
        to: None,
        force: None,
        base_revision: None,
        revision_id: None,
        json: args.json,
    };
    let payload = client.policy_op(&req).await?;
    if out.json {
        out.print_json(&payload.data)?;
    } else {
        let content = payload
            .data
            .get("content")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| serde_json::to_string_pretty(&payload.data).unwrap_or_default());
        print!("{content}");
    }
    Ok(())
}

async fn run_apply(args: PolicyApplyArgs, state_dir: Option<&str>) -> Result<()> {
    let out = Output::new(args.json);
    let (path_contents, path_name) = read_policy_path(&args.path)?;
    let client = ipc_or_err(state_dir).await?;
    let req = PolicyOpRequest {
        op: "apply".into(),
        path_contents: Some(path_contents),
        path_name: Some(path_name),
        format: None,
        from: None,
        to: None,
        force: Some(args.force),
        base_revision: args.base_revision,
        revision_id: None,
        json: args.json,
    };
    let payload = client.policy_op(&req).await?;
    if payload.data.get("conflict").and_then(|v| v.as_bool()) == Some(true) {
        if out.json {
            out.print_json(&payload.data)?;
        } else {
            eprintln!("drift detected - re-run with --force to overwrite");
            if let Some(body) = payload.data.get("body") {
                println!("{}", serde_json::to_string_pretty(body)?);
            }
        }
        std::process::exit(1);
    }
    print_policy_result("apply", &out, &payload.data)?;
    Ok(())
}

async fn run_history(args: PolicyHistoryArgs, state_dir: Option<&str>) -> Result<()> {
    let out = Output::new(args.json);
    let client = ipc_or_err(state_dir).await?;
    let req = PolicyOpRequest {
        op: "history".into(),
        path_contents: None,
        path_name: None,
        format: None,
        from: None,
        to: None,
        force: None,
        base_revision: None,
        revision_id: None,
        json: args.json,
    };
    let payload = client.policy_op(&req).await?;
    print_policy_result("history", &out, &payload.data)?;
    Ok(())
}

async fn run_rollback(args: PolicyRollbackArgs, state_dir: Option<&str>) -> Result<()> {
    let out = Output::new(args.json);
    let client = ipc_or_err(state_dir).await?;
    let req = PolicyOpRequest {
        op: "rollback".into(),
        path_contents: None,
        path_name: None,
        format: None,
        from: None,
        to: None,
        force: None,
        base_revision: None,
        revision_id: Some(args.revision_id),
        json: args.json,
    };
    let payload = client.policy_op(&req).await?;
    print_policy_result("rollback", &out, &payload.data)?;
    Ok(())
}

fn read_policy_path(path: &PathBuf) -> Result<(String, String)> {
    if path.is_file() {
        let content =
            fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        return Ok((
            content,
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("policy.json")
                .to_string(),
        ));
    }
    if path.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(path)
            .with_context(|| format!("read dir {}", path.display()))?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.path());
        for entry in entries {
            let p = entry.path();
            if p.is_file() {
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                if matches!(ext, "json" | "hcl" | "yaml" | "yml") {
                    let content =
                        fs::read_to_string(&p).with_context(|| format!("read {}", p.display()))?;
                    return Ok((
                        content,
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("policy.json")
                            .to_string(),
                    ));
                }
            }
        }
        bail!("no policy files found under {}", path.display());
    }
    bail!("path not found: {}", path.display())
}

fn print_policy_result(op: &str, out: &Output, data: &serde_json::Value) -> Result<()> {
    if out.json {
        out.print_json(data)?;
        return Ok(());
    }
    match op {
        "validate" => {
            let valid = data.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
            if valid {
                let hash = data.get("hash").and_then(|v| v.as_str()).unwrap_or("?");
                println!("policy: ok (hash {hash})");
                if let Some(warnings) = data.get("warnings").and_then(|v| v.as_array()) {
                    for w in warnings {
                        let msg = w.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        let path = w
                            .get("path")
                            .and_then(|v| v.as_str())
                            .map(|p| format!(" [{p}]"))
                            .unwrap_or_default();
                        eprintln!("warning{path}: {msg}");
                    }
                }
            } else {
                if let Some(errors) = data.get("errors").and_then(|v| v.as_array()) {
                    for e in errors {
                        let msg = e.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        let path = e
                            .get("path")
                            .and_then(|v| v.as_str())
                            .map(|p| format!(" [{p}]"))
                            .unwrap_or_default();
                        eprintln!("error{path}: {msg}");
                    }
                    std::process::exit(1);
                }
            }
        }
        "test" => {
            if let Some(results) = data.get("results").and_then(|v| v.as_array()) {
                for case in results {
                    let name = case.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                    let passed = case
                        .get("passed")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if passed {
                        println!("PASS  {name}");
                    } else {
                        let msg = case
                            .get("message")
                            .and_then(|v| v.as_str())
                            .map(|m| format!(" - {m}"))
                            .unwrap_or_default();
                        eprintln!("FAIL  {name}{msg}");
                    }
                }
            }
            let passed = data.get("passed").and_then(|v| v.as_u64()).unwrap_or(0);
            let failed = data.get("failed").and_then(|v| v.as_u64()).unwrap_or(0);
            println!("\n{passed} passed, {failed} failed");
            if failed > 0 {
                std::process::exit(1);
            }
        }
        "simulate" => {
            let verdict = data.get("verdict").and_then(|v| v.as_str()).unwrap_or("?");
            println!("verdict: {verdict}");
            if let Some(rules) = data.get("matched_rules").and_then(|v| v.as_array()) {
                if rules.is_empty() {
                    println!("matched: (none)");
                } else {
                    let names: Vec<_> = rules.iter().filter_map(|r| r.as_str()).collect();
                    println!("matched: {}", names.join(", "));
                }
            }
        }
        "apply" | "rollback" => {
            println!("{op}: {data}");
        }
        _ => {
            println!("{}", serde_json::to_string_pretty(data)?);
        }
    }
    Ok(())
}

trait PolicyJsonArgs {
    fn json_flag(&self) -> bool;
}

impl PolicyJsonArgs for PolicyPathArgs {
    fn json_flag(&self) -> bool {
        self.json
    }
}

impl PolicyJsonArgs for PolicyRemotePathArgs {
    fn json_flag(&self) -> bool {
        self.json
    }
}

impl PolicyJsonArgs for PolicySimulateArgs {
    fn json_flag(&self) -> bool {
        self.json
    }
}
