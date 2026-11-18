---
name: Portscope
description: A compact directory of local services.
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
  title:
    fontSize: "clamp(1.625rem, 2.4vw, 2rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
spacing:
  inline: "0.5rem"
  row-gap: "1.5rem"
  row-padding: "1.25rem"
  section: "2rem"
---

# Portscope visual system

## Overview

A single searchable service directory. The content leads; controls stay familiar
and information stays visible without opening a detail panel.
Product requirements live in [docs/design.md](docs/design.md).

## Colors

Nuxt UI semantic tokens are authoritative. `app/app.config.ts` selects teal for
actions and slate for neutral surfaces. Follow the system color preference.
Use `text-muted`, including placeholders, for secondary readable text.
Light mode maps muted text to neutral 600 and primary to teal 700 for contrast
on both default and elevated surfaces. It also maps `--ui-error` to
`--ui-color-error-700`, `--ui-success` to `--ui-color-success-800` and `--ui-warning`
to `--ui-color-warning-800` so destructive controls and status alerts use darker,
readable semantic colors. These overrides apply only in light mode.
Green means a current collection, amber warns of stale data, and errors include
explicit text rather than relying on color.

## Typography

System sans for interface text; monospace and tabular numerals for ports, elapsed
runtime, resource readings and filesystem paths. Long names and paths wrap rather
than disappearing.

## Layout

The shell is capped at 88rem. A compact product header precedes the search,
Git-only filter and refresh controls. Alerts and a conditional selection bar sit
above the service count and freshness summary.

Desktop rows use nine aligned columns: selection, ports, project/process,
elapsed runtime, CPU, RAM, branch/worktree, directory and stop action. At 72rem the
directory moves below the metadata, spanning from the port column to the end.
At 56rem the column headers disappear and rows become stacked records with three
tracks: checkbox, flexible content and actions. Ports and stop stay on the first
line; project, runtime, Git context and directory span the content area. CPU and
RAM appear side by side with explicit labels. The toolbar stacks and a sort select replaces
the sortable headers.

## Elevation & Depth

Use tonal surfaces and one-pixel separators. Avoid nested cards and decorative
shadows around inventory entries.

## Components

Use Nuxt UI controls inside `UApp`. Port and branch links open new tabs.
HTTP attempts are explicitly distinguished from identified web links.
Include loading, empty search, partial collection, failed refresh and paused
states. Pausing refresh keeps the list stable for inspection.

### Sorting and filtering

Port, project/process name, runtime, CPU and RAM headers toggle ascending/descending order.
The active sort uses a primary-colored direction icon and an accessible label.
The narrow-screen select exposes all ten sort choices. CPU and RAM sort by their
numeric measurements, with unavailable readings last in either direction. The Git-only checkbox
keeps rows with a known branch or worktree.

### Process readings and selection

Runtime and the separate CPU and RAM readings stay compact and monospace. Unavailable
readings show a dash; CPU tooltips explain sampling and that 100% means one core.
Eligible rows have a checkbox and an error-colored ghost stop button. Selected
rows receive a subtle primary tint. The header checkbox selects eligible visible
processes; filtering or refreshed data removes selections no longer visible or
eligible. The selection bar counts processes and offers stop and clear actions.

### Stop confirmation and results

Single and bulk stops share a Nuxt UI modal listing process names, PIDs and ports,
with a data-loss warning. Normal stop is the default each time the modal opens;
force requires an explicit checkbox. Cancel is neutral and the final stop action
uses the error color. More than 100 targets disables confirmation and displays
an error. Results report each process separately, distinguishing a sent signal
from a confirmed exit; failed targets remain selected for retry.

### Branch and directory actions

The branch copy button follows the branch text and external-link arrow, when
present. A temporary check icon and a polite announcement report copying.
Worktree names and observed directory paths are file-explorer buttons; a separate
ghost icon opens VS Code. Opening controls depend on an observed process identity
and directory. Failures appear in a dismissible alert.
