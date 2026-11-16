# Portscope

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Nuxt 4, Nuxt UI 4, Tailwind CSS 4 and TypeScript. The server and local collector
run as one native application on macOS or Linux.

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

- Read-only TCP inventory with search and periodic refresh.
- Process, directory, branch and worktree information when identifiable.
- Browser links open in a new tab; unclassified TCP listeners offer an explicitly
  labeled HTTP attempt rather than being presented as known web services.
- Remote branch links when the tracking branch and hosting provider are known.
- Unknown metadata and collection errors remain explicit.
- No service management, Docker requirement, central service or project-specific
  dependencies.
- No collection of secrets, process environments or full command lines.
- Keyboard-accessible controls and a usable narrow-screen layout.

## Brand Commitments

The name is Portscope. The interface must remain small and very simple.

## Evidence on Hand

The confirmed requirements are recorded in `docs/design.md`.
The running inventory will supply the interface's actual content.
