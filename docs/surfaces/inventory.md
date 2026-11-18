# Local inventory

Mode: Operate. One route, `/`, for finding, inspecting and stopping local services.
The confirmed brief calls for a very small utility.

## Direction contract

**THESIS:** An immediately searchable directory of running services. The inventory
itself is the main surface; no overview charts or decorative metric cards.

**OWN-WORLD:** Restrained teal actions, slate text and pale surfaces, with system
sans for labels and tabular monospace for ports, paths, runtime and resource
readings. Honor the user's system light/dark preference. The developer works
alongside an editor, so density and legibility matter more than an expressive
display face.

**STORY:** Find a port, identify its project and branch, open a recognized web
service, inspect RAM/CPU and elapsed runtime, or stop identified processes.
Unknown information remains explicit. Each row has a checkbox and an individual
stop action. Branch names can be copied beside the external link; observed
directories open in the file explorer or VS Code.

**FIRST VIEWPORT:** Compact product header and title, search and refresh controls
and a branch/worktree checkbox filter. Alerts and a conditional selection bar
precede the service count and freshness summary, then aligned service rows with
separate CPU, RAM and runtime readings. Clickable headers sort port, project/process
name, runtime, CPU and RAM in either direction; a narrow-screen select exposes the same
ten choices. Unavailable metrics sort last. The selection bar counts checked, visible processes and offers bulk
stop and deselect actions. A focused confirmation lists names, PIDs and ports,
warns about data loss and defaults to normal stop; force is explicit. Per-process
results distinguish a sent signal from an exited process and retain failed
targets for retry.

Desktop rows align selection, ports, project/process, runtime, CPU, RAM,
branch/worktree, directory and stop action. At 72rem the directory moves beneath
the metadata; at 56rem headers disappear and rows become stacked three-track
records, keeping checkbox, ports and stop on the first line. The toolbar stacks,
with the Git-only filter beside the sort select. Pausing refresh holds the
inventory still for inspection.

**FORM:** A compact indexed directory, translated into ordinary web controls.
The user's explicit simplicity requirement constrains the design.
Exploration reference: seed:795b94240a7174c0.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
