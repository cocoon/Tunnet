# tunnet update

`tunnet update --check` reads the Core channel and does not need admin. `tunnet update` downloads, verifies, and activates Core and needs `sudo` on Linux/macOS or an elevated prompt on Windows.

Desktop has its own channel (`desktop-latest`). Core installers and `tunnet update` use `core-latest`.

```bash
curl -fsSL https://get.tunnet.io | sh
```

```powershell
irm https://get.tunnet.io | iex
```

After Core is running, later Core updates go through the agent.

Check the current version with `tunnet --version`.

## Automatic updates

Headless auto-update uses the same Core channel, including attestation/digest checks, a health window, and rollback of the Core files together.
