# One assistant, several computers

Run one workspace coordinator on an always-on computer. Android, desktop and Even G2 connect to that same HTTPS endpoint over Tailscale. The assistant's history, task graph, questions, attachments and notifications live in one SQLite database. Other computers execute tasks over SSH using their own Codex/Claude installation and login.

This is a single-coordinator design. There is no automatic coordinator failover, database replication or simultaneous resume of one native session on two computers. When a laptop sleeps, coordinator-local work continues. Work explicitly assigned to that laptop cannot continue there until it becomes available.

## Configure devices

Install the same build and Node 22.16+ on every computer. Authenticate Codex/Claude independently. Configure noninteractive SSH **in both directions**, verify host keys once, and verify the same commands work under the service user's environment. Use absolute binary paths: version-manager shims can require shell initialization or trusted directories.

Create `devices.json` in the coordinator's `--home` directory:

```json
{
  "localId": "xps",
  "defaultId": "xps",
  "coordinatorSshHost": "xps",
  "devices": [
    {"id": "xps", "name": "XPS · Home", "cwd": "/home/you/projects"},
    {
      "id": "macbook",
      "name": "MacBook",
      "cwd": "/Users/you/projects",
      "sshHost": "mac",
      "command": [
        "/usr/bin/env", "PATH=/opt/homebrew/bin:/usr/bin:/bin",
        "ORCHESTRATOR_CODEX_BIN=/absolute/path/to/codex",
        "ORCHESTRATOR_CLAUDE_BIN=/absolute/path/to/claude",
        "/absolute/path/to/node", "/absolute/path/to/orchestrator/dist/cli.js", "device-worker"
      ]
    }
  ]
}
```

`coordinatorSshHost` is resolved **on workers**, not just the coordinator. Nested children call back to the central daemon over SSH; they do not create a second root database. The coordinator's absolute Node/CLI/home paths must remain valid. SSH does not forward the full environment or provider credentials. Workers use local credentials and integrations.

Add a third computer as another device entry, install the same build there and verify both SSH directions. Restart the coordinator when no runs are active. IDs are permanent identities: do not recycle them for another computer while existing sessions reference them.

Run the coordinator as a persistent systemd user service (Linux; enable user lingering if it must survive logout), or a launch agent (macOS). Keep its HTTP listener on loopback and expose it through `tailscale serve`. Do not reuse an occupied port or replace unrelated Tailscale routes. Set `ORCHESTRATOR_COORDINATOR_URL` to its HTTPS tailnet origin so authenticated clients can remember the direct address. Enable only the exact G2 companion origin in `ORCHESTRATOR_BROWSER_ORIGINS`.

## Routing rules

- The assistant stays on the coordinator (`localId`).
- New app sessions use the selected device, initially `defaultId`.
- Child tasks inherit the parent's device and working directory unless explicitly overridden.
- `delegate_task` accepts `deviceId` and optional absolute `cwd`; choosing another device starts in that device's configured directory.
- Ordinary local MCP calls retain their scope's project directory.
- A session's device cannot be changed by sending another message. Create a new session to use another computer.
- Existing terminal sessions can be listed and resumed on their own device. Confirm that the terminal is not simultaneously driving that session.
- A remote worktree is created on the worker. Its base commit is resolved when execution starts; uncommitted changes and repositories are **not synced** between devices.
- Attachments are copied to the execution device before submission. Reusing an upload ID with different bytes is rejected.

Desktop and Android expose the selector when opening a session and show device labels in task/session lists. G2 exposes it in the phone companion and in its glasses **Cihaz** menu. A glasses selection is an explicit routing instruction for new voice-delegated work; a voice message in an existing task retains that task's context. The assistant itself never moves.

## Disconnects and recovery

SSH keepalives bound a dead connection. A connection failure, lost acknowledgement or invalid worker response is not proof that no side effect happened. The task becomes `recovery_required`; no automatic failover or replay occurs. Check the recorded session and files on the worker before explicitly continuing. Cancellation still propagates through the central task tree; a disconnected worker may observe termination only when SSH detects the loss.

`GET /v1/devices` returns a bounded, cached reachability probe. `GET /v1/state` returns device identities without blocking on remote health. Native-history and upload requests have deadlines. Mutating calls retain request IDs across transport retries.

## Moving an existing coordinator

1. Stop accepting work and wait for active tasks to finish. Stop the old coordinator before copying its database.
2. Back up the database, configuration and service definition. Copy SQLite after clean shutdown (or use SQLite's backup API).
3. Copy workspace uploads and **only the assistant's native session** if preserving that exact conversation. Provider authentication remains local to each computer.
4. Update the assistant's cwd/device and its scope to the new coordinator. Tag historical sessions with their original device; preserve task/run IDs. Record upload path aliases in `workspace_upload_paths` when paths move.
5. Start exactly one coordinator, verify the same assistant ID and actual provider resume, then point every client directly to it.
6. An optional `workspace-proxy --target https://coordinator.tailnet.ts.net:9443 --port 8787` keeps an old local endpoint working while clients migrate. This proxy runs no engine. It still depends on the old computer; direct client migration is required before that computer sleeps.

For rollback, stop the new coordinator first and reconcile work created since migration before restoring the old backup. Never start both databases as competing assistants.

## Validation

Automated tests cover parent/device inheritance, local project retention, unknown devices, request-ID conflicts, SSH quoting, and uncertain outcomes without replay. Provider and UI tests are separate from these checks. A real two-host acceptance test should cover Linux-local Codex/Claude, a macOS task with an inherited child, an attachment on the worker, direct client connectivity, native history, and a deliberate worker disconnect. Do not describe physical phone/glasses checks as passed when only an emulator or SDK bridge test ran.
