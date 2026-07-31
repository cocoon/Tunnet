//! On Windows, copy vendored wintun.dll next to `tunnet.exe` (shared agent resources).

#[cfg(windows)]
mod wintun_bundle {
    include!("../tunnet-agent/build/wintun_bundle.rs");
}

fn main() {
    #[cfg(windows)]
    {
        let resources = std::path::PathBuf::from(
            std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"),
        )
        .join("../tunnet-agent/resources/wintun");
        wintun_bundle::bundle(&resources);
    }
}
