# Portscope

A read-only dashboard of TCP services listening on your machine. Native macOS and
Linux, one Nuxt process, no database, no project registration.

## Run

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

- macOS: `lsof`; Linux: `ss` plus `/proc`, falling back to `lsof`.
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
pnpm build
pnpm test:integration # launches temporary production servers and external TCP fixtures
```

Tests exercise lsof/ss parsing (IPv4/IPv6 and missing owners), real Git metadata
including worktrees, live collection on the current OS, cache/error behavior,
Host/Origin protection, occupied-port rejection, and safe service-file generation.
macOS tests do not establish that the Linux collector or systemd activation
works on a real Linux host. User-login activation/removal is a separate,
approval-gated machine check.
