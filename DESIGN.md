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
on both default and elevated surfaces.
Green means a current collection, amber warns of stale data, and errors include
explicit text rather than relying on color.

## Typography

System sans for interface text; monospace and tabular numerals for ports and
filesystem paths. Long names and paths wrap rather than disappearing.

## Layout

The shell is capped at 88rem. Desktop rows align ports, process/project,
branch/worktree and directory. At 72rem the directory moves below the metadata.
At 48rem rows become two-column records, with controls stacked above.

## Elevation & Depth

Use tonal surfaces and one-pixel separators. Avoid nested cards and decorative
shadows around inventory entries.

## Components

Use Nuxt UI controls inside `UApp`. Port and branch links open new tabs.
HTTP attempts are explicitly distinguished from identified web links.
Include loading, empty search, partial collection, failed refresh and paused
states. Pausing refresh keeps the list stable for inspection.
