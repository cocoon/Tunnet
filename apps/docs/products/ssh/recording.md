# Session Recording

SSH session recording captures the terminal output of SSH sessions for audit and compliance purposes.

## Enabling recording

Recording is enabled per-machine by setting `TUNNET_RECORDER=1` on the agent daemon (service environment or foreground `tunnetd`):

```bash
# OS service - set in the service environment, then restart
TUNNET_RECORDER=1

# Foreground
TUNNET_RECORDER=1 sudo tunnetd
```

## Recording rules

Recording can also be enforced through SSH policies configured in **Networks → Access → SSH Rules**. These rules can mandate recording for specific tags, users, or all sessions.

## Replaying sessions

```bash
# List all recordings
tunnet ssh recordings

# Play a recording
tunnet ssh play <session_id>
```

Recordings are also viewable in the dashboard under **SSH → Recordings**.
