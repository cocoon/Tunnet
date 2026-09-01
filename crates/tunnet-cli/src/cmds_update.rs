use clap::Args;

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// Check the Core channel without installing. Does not need admin or sudo.
    #[arg(long)]
    pub check: bool,
    /// Download even when already on the latest Core version
    #[arg(long)]
    pub force: bool,
    /// Hard-restart the service after activation (ignored on the Core updater)
    #[arg(long)]
    pub restart: bool,
    /// Unused. The Core channel does not accept a pinned version.
    #[arg(long)]
    pub version: Option<String>,
}
