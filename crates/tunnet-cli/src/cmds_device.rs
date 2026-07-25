use clap::{Args, Subcommand};

#[derive(Subcommand, Debug)]
pub enum LabelsCommand {
    Set(LabelsSetArgs),
    Get,
    Delete(LabelsDeleteArgs),
}

#[derive(Subcommand, Debug)]
pub enum TagCommand {
    List,
    Add(TagAddArgs),
    Remove(TagRemoveArgs),
}

#[derive(Args, Debug)]
pub struct TagAddArgs {
    pub tag: String,
}

#[derive(Args, Debug)]
pub struct TagRemoveArgs {
    pub tag: String,
}

#[derive(Args, Debug)]
pub struct LabelsSetArgs {
    pub pairs: Vec<String>,
}

#[derive(Args, Debug)]
pub struct LabelsDeleteArgs {
    pub key: String,
}

#[derive(Subcommand, Debug)]
pub enum MachineCommand {
    SetExpiry(MachineSetExpiryArgs),
}

#[derive(Args, Debug)]
pub struct MachineSetExpiryArgs {
    pub duration: String,
}

pub async fn run_labels(command: LabelsCommand, state_dir: Option<&str>) -> anyhow::Result<()> {
    match command {
        LabelsCommand::Set(args) => {
            crate::cmds_bootstrap::device_labels_set(&args.pairs, state_dir).await
        }
        LabelsCommand::Get => {
            let client = crate::cmds::ipc_or_err(state_dir).await?;
            let info = client.device_info().await?;
            let labels = info
                .data
                .get("labels")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            print_labels(&labels);
            Ok(())
        }
        LabelsCommand::Delete(args) => {
            crate::cmds_bootstrap::device_labels_delete(&args.key, state_dir).await
        }
    }
}

pub async fn run_tags(command: TagCommand, state_dir: Option<&str>) -> anyhow::Result<()> {
    match command {
        TagCommand::List => {
            let client = crate::cmds::ipc_or_err(state_dir).await?;
            let info = client.device_info().await?;
            let tags: Vec<String> = info
                .data
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            print_tags(&tags);
            Ok(())
        }
        TagCommand::Add(args) => crate::cmds_bootstrap::device_tags_add(&args.tag, state_dir).await,
        TagCommand::Remove(args) => {
            crate::cmds_bootstrap::device_tags_remove(&args.tag, state_dir).await
        }
    }
}

pub async fn run_machine(command: MachineCommand, state_dir: Option<&str>) -> anyhow::Result<()> {
    match command {
        MachineCommand::SetExpiry(args) => {
            crate::cmds_bootstrap::device_expiry(&args.duration, state_dir).await
        }
    }
}

fn print_tags(tags: &[String]) {
    if tags.is_empty() {
        println!("(no tags)");
        return;
    }
    for tag in tags {
        println!("tag:{tag}");
    }
}

fn print_labels(labels: &serde_json::Map<String, serde_json::Value>) {
    if labels.is_empty() {
        println!("(no labels)");
        return;
    }
    let mut keys: Vec<_> = labels.keys().collect();
    keys.sort();
    for key in keys {
        let value = labels[key].as_str().unwrap_or("");
        println!("{key}={value}");
    }
}
