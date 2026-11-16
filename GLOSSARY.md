# Portscope

Portscope provides a local overview of services listening on a machine and their
project context, when that context can be identified.

## Language

**Observed service**:
A running program with one or more listening TCP endpoints visible on the local
machine. An observed service is not necessarily a web application.
_Avoid_: Application, website

**Local inventory**:
The current collection of observed services on one machine. It describes what is
running, rather than what has been configured to run.
_Avoid_: Project registry, process supervisor

**Project context**:
The identified association between an observed service and its project directory,
Git branch and worktree, where applicable. Missing information means the
association is unknown, not that the service has no project.
_Avoid_: Ownership
