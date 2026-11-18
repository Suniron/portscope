# Portscope

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Nuxt 4, Nuxt UI 4, Tailwind CSS 4 and TypeScript. Electrobun embeds Bun, the server
and frontend in a desktop application on macOS and Windows. The web CLI also
supports Linux.

## Users

Developers working on multiple local projects and Git worktrees simultaneously.
They need to identify which service occupies a port and open the right web app.

## Product Purpose

Show the machine's current listening services and their project context at a
glance, without requiring projects to register with the tool.

## Operating Context

The application runs locally during the user's session. Its listening port is
configurable, defaulting to 3100. It can start automatically at login.

## Capabilities and Constraints

- TCP inventory with search, periodic refresh, per-process RAM/CPU usage and
  elapsed runtime.
- Process, directory, branch and worktree information when identifiable.
- Browser links open in a new tab; unclassified TCP listeners offer an explicitly
  labeled HTTP attempt rather than being presented as known web services.
- Remote branch links when the tracking branch and hosting provider are known.
- Sort by port, elapsed runtime, project name, CPU or RAM; optionally show only services
  with a known branch or worktree.
- Copy branch names and open observed project/worktree directories in the system
  file explorer or VS Code.
- Unknown metadata and collection errors remain explicit.
- Windows provides ports and process names; process working directories and their
  project/Git context remain unknown.
- Stop an identified process, individually or in a checked selection, after
  confirmation. Normal stop is the default; force stop is an explicit option.
- No service startup/restart, privilege escalation, Docker requirement, central
  service or project-specific dependencies.
- No collection of secrets, process environments or full command lines.
- Keyboard-accessible controls and a usable narrow-screen layout.

## Brand Commitments

The name is Portscope. The interface must remain small and very simple.

## Evidence on Hand

The confirmed requirements are recorded in `docs/design.md`.
The running inventory will supply the interface's actual content.
