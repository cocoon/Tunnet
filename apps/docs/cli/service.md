# tunnet service

Install and manage Tunnet as an OS service (systemd on Linux, launchd on macOS, Windows Service on Windows).

## Usage

```bash
tunnet service install     # Write the service unit (needs root/admin)
tunnet service uninstall   # Remove the service unit
tunnet service start       # Start the daemon
tunnet service stop        # Stop the daemon
tunnet service restart     # Restart the daemon
tunnet service status      # Show service status
```

## Notes

`tunnet service start` writes the service unit if it is missing, then starts the daemon. `tunnet service install` only writes the unit. After the service is running, the agent starts automatically on boot.
