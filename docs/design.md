# Portscope — agreed product design

Status: implemented; macOS validation completed.

## Purpose

A small web dashboard showing services currently listening on the
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
- Show per-process RAM/CPU when available, without hiding listeners whose
  resource metrics cannot be read.
- Show elapsed runtime in seconds, minutes or hours/minutes. Sort rows in either
  direction by port, duration, project name, CPU or RAM, without grouping overriding order.
  CPU and RAM have separate columns; missing measurements remain last in either direction.
- Offer a checkbox filter for rows with an identified branch or worktree.
- Copy the branch name with a button immediately after its external link arrow.
- Open the observed worktree/project directory in the file explorer or VS Code,
  without accepting arbitrary client-supplied paths or changing OS defaults.
- Allow stopping a process or a checked selection after a confirmation listing
  the target processes. Default to normal stop, with an explicit force option.
- On macOS/Linux, offer to include the displayed PID of a dedicated Node parent
  in that confirmation. Do not signal shared launchers or process groups.
- Revalidate process identity before stopping; never accept arbitrary PIDs from
  a page. Protect Portscope and its ancestors, and report per-process failures.
- Never elevate privileges or start/restart services.
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
11. RAM and CPU appear per process; unknown or warming-up values are explicit.
12. Single and bulk stop require confirmation. Filtering never silently includes
    hidden selections, and reused PIDs cannot be stopped using stale identities.
13. Cross-origin requests cannot stop processes; inaccessible or protected
    processes report an error without aborting the rest of a batch.
14. Sorting, filtering and elapsed time remain usable on narrow screens. Opening
    directories is same-origin only and validates the observed process identity.

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

### Process controls and navigation

- Unit coverage includes process identity, ancestry protection, CPU sampling,
  stop validation, per-target outcomes, directory opening, sorting and selection.
- Production integration stops only its own TCP fixtures, exercises CSRF refusal
  and rejects stale identities. It waits for fixture metadata because partial
  collection under load is an intentional bounded response.
- The standalone macOS package checks its own metrics and protection and rejects
  mutation requests without an Origin.
- Browser checks at 1320px and 390px cover individual/bulk/forced stops on test
  fixtures, selection pruning, cancel, sorting, Git filtering and branch copying.
  Finder opening was verified against the observed project directory.
- Native Windows/Linux process control and a screen-reader session are not
  validated by the macOS checks.
