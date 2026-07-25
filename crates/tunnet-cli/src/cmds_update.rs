use clap::Args;

#[derive(Args, Debug)]
pub struct UpdateArgs {
    #[arg(long)]
    pub check: bool,
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub restart: bool,
    #[arg(long)]
    pub version: Option<String>,
}
