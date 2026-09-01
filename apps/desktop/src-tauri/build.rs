fn main() {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let cargo_version = std::env::var("CARGO_PKG_VERSION").unwrap();
    let package: serde_json::Value = serde_json::from_slice(
        &std::fs::read(manifest_dir.join("../package.json")).expect("read desktop package.json"),
    )
    .expect("parse desktop package.json");
    let config: serde_json::Value = serde_json::from_slice(
        &std::fs::read(manifest_dir.join("tauri.conf.json")).expect("read tauri.conf.json"),
    )
    .expect("parse tauri.conf.json");
    let package_version = package["version"].as_str().expect("package.json version");
    let config_version = config["version"].as_str().expect("tauri.conf.json version");
    let updater_pubkey =
        std::fs::read_to_string(manifest_dir.join("updater.pub")).expect("read updater.pub");
    assert_eq!(
        cargo_version, package_version,
        "desktop Cargo.toml and package.json versions differ"
    );
    assert_eq!(
        cargo_version, config_version,
        "desktop Cargo.toml and tauri.conf.json versions differ"
    );
    assert_eq!(
        config["plugins"]["updater"]["pubkey"].as_str(),
        Some(updater_pubkey.trim()),
        "tauri.conf.json updater key and updater.pub differ"
    );
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=updater.pub");
    tauri_build::build()
}
