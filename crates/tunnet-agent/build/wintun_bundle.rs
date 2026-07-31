// Copy vendored `resources/wintun/<arch>/wintun.dll` beside built Windows binaries.

use std::path::{Path, PathBuf};

pub fn bundle(resources_wintun_dir: &Path) {
    let arch_dir = target_wintun_arch_dir();
    let src = resources_wintun_dir.join(arch_dir).join("wintun.dll");

    println!("cargo:rerun-if-changed={}", src.display());
    if let Ok(entries) = std::fs::read_dir(resources_wintun_dir) {
        for entry in entries.flatten() {
            println!("cargo:rerun-if-changed={}", entry.path().display());
        }
    }

    if !src.is_file() {
        panic!(
            "missing vendored wintun.dll at {} (expected resources/wintun/{}/wintun.dll in the repo)",
            src.display(),
            arch_dir
        );
    }

    let dest_dir = cargo_profile_dir();
    std::fs::create_dir_all(&dest_dir).expect("create cargo profile dir");

    let dest = dest_dir.join("wintun.dll");
    match std::fs::copy(&src, &dest) {
        Ok(_) => {}
        Err(e) if dest.exists() => {
            // Running service often locks wintun.dll; keep the existing copy.
            println!(
                "cargo:warning=wintun.dll copy skipped ({} in use): {e}",
                dest.display()
            );
        }
        Err(e) => {
            panic!("failed to copy wintun.dll to {}: {e}", dest.display());
        }
    }
}

fn target_wintun_arch_dir() -> &'static str {
    match std::env::var("CARGO_CFG_TARGET_ARCH")
        .expect("CARGO_CFG_TARGET_ARCH")
        .as_str()
    {
        "x86_64" => "amd64",
        "x86" => "x86",
        "aarch64" => "arm64",
        "arm" => "arm",
        other => panic!("unsupported Windows arch for wintun bundling: {other}"),
    }
}

fn cargo_profile_dir() -> PathBuf {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target_root = std::env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join("../../target"));
    let profile = std::env::var("PROFILE").expect("PROFILE");
    let target = std::env::var("TARGET").expect("TARGET");
    let host = std::env::var("HOST").expect("HOST");
    if target == host {
        target_root.join(profile)
    } else {
        target_root.join(target).join(profile)
    }
}
