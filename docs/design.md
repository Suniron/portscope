# Portscope — agreed product design

Status: implemented; macOS validation completed.

## Purpose

A small, read-only web dashboard showing services currently listening on the
local machine. It works with arbitrary projects and requires no project-specific
integration or registration.

See [the glossary](../GLOSSARY.md) for the domain vocabulary.

## Deployment

- Independent project at `~/projects/perso/portscope`.
- Native application on macOS and Linux; Docker is not required.
- Nuxt 4, Nuxt UI 4, Tailwind CSS 4 and TypeScript, with pnpm.
- One application process: the Nuxt server also collects the local inventory.
- Accessible only through loopback interfaces.
- Configurable listening port, defaulting to 3100.
- Optional installation of automatic startup at user login, using the platform's
  user-service mechanism. Startup installation must preserve existing services
  and receive any required native approvals.
- Port availability and permission to bind must be checked on the target machine.
  Do not run the whole application as root to obtain a privileged port; if it cannot bind,
  report the problem and allow an explicitly configured alternative port.
- Automatic startup means availability during the user's session, not a
  machine-wide service guaranteed to run before login.

## Inventory and interface

- Discover listening TCP endpoints, including programs started outside the tool.
- Show address, port, process identity and project context when available.
- Identify the project directory, Git branch and worktree when evidence permits.
  Link to the remote tracking branch when its hosting provider is recognized,
  without contacting the remote or disclosing credentials embedded in Git URLs.
- Group related endpoints where their association is known; do not assume that
  each port is a separate application or that every TCP listener is HTTP.
- Provide search, periodic refresh and new-tab browser links for identified web
  services. Unclassified listeners offer an explicitly labeled "Try HTTP" action;
  it navigates only when clicked and does not imply that HTTP was detected.
- Clearly distinguish unknown metadata, collection errors and a healthy empty
  inventory. An unavailable collector must not make stale data look current.
- Include services whose project context cannot be determined.
- Report only information accessible to the current user; no elevated collector.
- Observe services without starting, stopping or restarting them.
- Do not collect process environments, secrets, request cookies or full command
  lines that could expose credentials.
- No project-specific names, dependencies, configuration rules or examples.
- No database or historical inventory is required for the initial version.

## Acceptance checks

1. Two unrelated projects appear without registration.
2. Services in different worktrees show the correct branch and directory where
   process metadata is accessible.
3. A non-HTTP TCP service remains visible; any HTTP attempt is explicitly labeled
   as such rather than presented as a detected web application.
4. Starting and stopping an external service updates the inventory.
5. Missing process metadata does not hide an otherwise visible endpoint.
6. A collector failure is visible and distinct from an empty inventory.
7. The configured port is respected; occupancy or permission failure produces an
   actionable error rather than an undocumented port change.
8. Automatic startup can be installed and removed without disturbing unrelated
   user services.
9. The UI remains usable with a narrow viewport and keyboard navigation.
10. A recognized upstream branch opens its hosting provider in a new tab;
    credentials, query parameters and fragments never appear in its link.

## Verification

- Full Nuxt typecheck and production build pass.
- 31 unit tests and two production integrations pass, including actual listeners,
  Git/worktree attribution, FIFO metadata, bounded timeout recovery and API guards.
- Browser checks cover search/reset, pause, new-tab links and a 390px viewport.
  Axe reports zero WCAG A/AA violations in both light and dark themes.
- The macOS login LaunchAgent was installed and started successfully on port 3100;
  its production API returns inventory and rejects cross-origin requests.
- Native Linux execution, a fresh macOS login, real network-filesystem stalls and
  a screen-reader session remain unverified. Linux unit fixtures are not native
  platform validation.
