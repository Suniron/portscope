# Portscope

A dashboard of TCP services listening on your machine. macOS, Windows
and Linux collection, one Nuxt process, no database, no project registration.

Inspect RAM/CPU per process and stop one process or a checked selection after
confirmation. Normal stop is the default; force stop is optional. Stopping may
lose unsaved work. Portscope never elevates privileges or stops its own process
or ancestors. Unknown process identity disables stopping.

Elapsed runtime is shown in seconds, minutes or hours/minutes. Sort by port,
runtime, project name, CPU or RAM, filter to known branches/worktrees, copy a branch name,
and open an observed directory in your file explorer or VS Code.

CPU needs two inventory samples; `100 %` means one logical CPU core. RAM is
resident memory (RSS), not a sum of project processes. Missing measurements stay
unknown. Under Windows, normal stop is not universally available: use the explicit
force option when the interface reports it as unsupported.

Process identity is checked again before stopping, but this is best-effort:
on macOS the process start timestamp has second precision, and inspecting a PID
then signaling it is not atomic. No elevated privileges are requested.

On macOS and Linux, the stop dialog can also include a dedicated Node parent. Use
this option when stopping the listener alone would leave a development watcher
running. Portscope shows the parent PID and rechecks that it is a same-user Node
process in the same process group, with the listener as its only child. It does
not send a signal to the group or walk up to a shell or package manager.

## Run

### Desktop application (Electrobun)

Download ready-to-use apps from [GitHub Releases](https://github.com/Suniron/portscope/releases/latest):
`Portscope-macOS-arm64.zip` for Apple Silicon, or `win-x64-Portscope-Setup.zip`
for Windows x64. Extract the whole archive before opening the app or installer.

The standalone app includes Bun, the Nuxt server and all frontend assets. End users
need neither Node, Bun nor pnpm. Build on the target OS with Node 22.18+ and pnpm
(build-time only): macOS 14+ on Apple Silicon, or Windows 10/11 x64 with the
Microsoft Edge WebView2 runtime.

```sh
pnpm install
pnpm desktop:build
```

Electrobun 2.0.6 and its paired Hutch toolchain are pinned; the npm bootstrap
downloads build tools into the ignored project-local `.hutch/store/`, not a global
installation. The build uses `.output-desktop/` (`node-listener`), separate from the
web CLI's `.output/` (`node-server`).

- **macOS:** `build/stable-macos-arm64/Portscope.app`. Copy it manually in Finder
  to your preferred Applications folder, then double-click it.
- **Windows:** `artifacts/win-x64-Portscope-Setup.zip`. Extract the **whole ZIP**
  before running the setup executable: its adjacent hidden payload is required.
  Windows PowerShell and the NetTCPIP module provide read-only port collection.

`pnpm desktop:start` launches the built app without installing it. No login item
or background service is installed. Closing the last window or choosing Quit
quits the app and its same-process server; other Portscope servers are never stopped.

The **Windows application** GitHub Actions workflow builds on `windows-latest`
(Electrobun does not cross-compile from macOS). Run it manually in the Actions tab;
after collection, type and packaged-runtime checks pass, download
**Portscope-Windows-x64** from the run's artifacts. Builds do not run on every push.
Artifacts are retained for 30 days; the repository's normal access controls apply.

Each launch reserves its own free port on `127.0.0.1`, even when the web default
3100 is occupied. The normal Host/Origin protections remain active. Only that
listener, not Electrobun's same-process IPC ports, is advertised as HTTP. External
HTTP(S) links open in the default browser; the sandboxed webview cannot navigate
away from its exact local origin and exposes no privileged RPC.

These builds are **not signed or notarized**. macOS Gatekeeper or Windows
SmartScreen may require explicit approval. Signing/notarization and
Intel Mac/Linux/Windows ARM64 app builds are outside this setup.

### Web CLI

Use Node 22.18+ and pnpm. Install dependencies and build:

```sh
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:3100`. The product default is **port 3100**. If the port is occupied
or your user cannot bind it, startup fails with an actionable message. There is
no silent fallback and no reason to run as root:

```sh
PORTSCOPE_PORT=3200 pnpm start
# development (same loopback-only binding and strict initial port check)
PORTSCOPE_PORT=3200 pnpm dev
```

Do not launch `.output/server/index.mjs` directly: the start wrapper validates
the port, rejects root and forces loopback binding despite inherited host settings.
Only `PORTSCOPE_PORT` configures the supported launcher. No `.env` file is needed.

## Collection and privacy

- macOS: `lsof`; Linux: `ss` plus `/proc`, falling back to `lsof`;
  Windows: PowerShell `Get-NetTCPConnection` and process names.
- Windows process working directories are not exposed by this collector.
  Directories and their project/Git context remain explicitly unknown; executable
  directories are never substituted for process working directories.
- Process names, PIDs, listening addresses, cwd and read-only Git/project metadata.
- No full command lines, process environments, HTTP probes, cookies or secrets.
- Endpoints are grouped by PID where available. Unknown owners remain visible.
- Project manifests are parsed as JSON, never executed. Git commands only read
  metadata; worktree paths and branches are shown when accessible. Branch links
  use an explicitly configured, locally known upstream branch on github.com,
  gitlab.com or bitbucket.org, without contacting remotes or exposing clone
  credentials. Missing upstreams and unsupported forges have no branch link.
- Browser links are deliberately conservative: only Portscope's own HTTP listener
  is positively identified. A familiar port or a framework dependency alone is not
  proof that an arbitrary process speaks HTTP. Other services offer an explicit
  **Try HTTP** action using their listening address. Links open in a new tab;
  no connection is attempted until you click.
  Scoped IPv6 addresses remain visible but have no browser link, since browsers
  do not support their zone identifiers.
- The inventory is coalesced/cached for five seconds, including brief failures.
  A failure returns HTTP 503 instead of stale or fictitiously empty data. Metadata
  work is bounded; inaccessible metadata produces warnings, not hidden endpoints.
- The server binds `127.0.0.1`; Host and Origin checks reject rebinding and
  cross-origin reads. There is no wildcard CORS. This is not authentication
  against other software running as your local user.

`GET /api/inventory` returns the shared `Inventory` contract in
`shared/types/inventory.ts` (`#shared/types/inventory` in Nuxt).

## Optional user-login startup

**Installation changes user services. Review the dry run and obtain the relevant
native approval before running the install command.** Build first. No startup
service is installed by dependency installation, build or tests.

```sh
PORTSCOPE_PORT=3100 pnpm autostart install --dry-run
# When approved:
PORTSCOPE_PORT=3100 pnpm autostart install
pnpm autostart uninstall --dry-run
# When approved:
pnpm autostart uninstall
```

The CLI refuses root. macOS uses `~/Library/LaunchAgents/local.portscope.plist`,
Linux uses `~/.config/systemd/user/portscope.service` with `systemctl --user`.
The absolute Node and project paths are recorded (spaces and XML/unit quoting
are supported). Reinstall after moving the project or changing your Node path.
An existing service is never overwritten; unrelated service files are refused.
Uninstall before changing the configured port and reinstalling.

This is user-session startup, not a pre-login system daemon. Linux needs an
active user systemd manager; the script does not enable lingering or use sudo.
macOS logs: `~/Library/Logs/Portscope/`; Linux logs:
`journalctl --user -u portscope.service`. An activation failure leaves the owned
service file for inspection/removal; removal preserves build files and logs.
After install, verify the displayed loopback URL and service status; no restart
loop conceals bind failures.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm desktop:typecheck # after desktop:build (prepares the generated SDK)
pnpm desktop:test # after desktop:build; extracts and runs bundled Bun/server without a GUI
pnpm build
pnpm test:integration # launches temporary production servers and external TCP fixtures
```

Tests exercise lsof/ss/PowerShell parsing (IPv4/IPv6 and missing owners), real Git metadata
including worktrees, live collection on the current OS, cache/error behavior,
Host/Origin protection, occupied-port rejection, and safe service-file generation.
The Windows workflow runs the PowerShell collector against real listeners and
tests the packaged Bun backend without system JS tools. Native window interactions
and installer UI still require a Windows desktop. macOS tests do not establish that
the Linux collector or systemd activation works on a real Linux host. User-login
activation/removal is a separate, approval-gated machine check.
