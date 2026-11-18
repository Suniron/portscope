import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import type { ObservedService } from '../../shared/types/inventory.ts'

const exec = promisify(execFile)
export interface ProcessInfo {
  pid: number
  ppid: number | null
  pgid?: number
  uid?: number
  executable?: string
  processStartId: string | null
  startedAt: string | null
  rssBytes: number | null
  cpuSeconds: number | null
}

export function parsePs(output: string): Map<number, ProcessInfo> {
  const rows = new Map<number, ProcessInfo>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+(?:\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})?)\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const [, pid, ppid, pgid, uid, rss, time, start, executable] = match
    if (!Number.isSafeInteger(Number(pid)) || !Number.isSafeInteger(Number(ppid))) continue
    const cpu = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(time!)
    const seconds = cpu ? Number(cpu[1] ?? 0) * 86400 + Number(cpu[2] ?? 0) * 3600 + Number(cpu[3]) * 60 + Number(cpu[4]) : null
    const cpuSeconds = seconds !== null && Number.isFinite(seconds) ? seconds : null
    const rssBytes = /^\d+$/.test(rss!) && Number.isSafeInteger(Number(rss) * 1024) ? Number(rss) * 1024 : null
    const processStartId = /^[A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(start!) ? start!.replace(/\s+/g, ' ') : null
    const timestamp = processStartId === null ? NaN : Date.parse(processStartId)
    rows.set(Number(pid), {
      pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), uid: Number(uid),
      executable: basename(executable!), rssBytes, cpuSeconds,
      processStartId, startedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
    })
  }
  return rows
}

// Only the two parent-ID fields are requested from CIM; never command lines or environment.
export const WINDOWS_PARENTS_SCRIPT = `
$parents = @{}
Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId -ErrorAction Stop |
  ForEach-Object { $parents[[long]$_.ProcessId] = [long]$_.ParentProcessId }
`

export async function inspectProcesses(pids: number[] = [], platform = process.platform, signal?: AbortSignal): Promise<Map<number, ProcessInfo>> {
  if (platform === 'win32') {
    const script = `
$ErrorActionPreference = 'Stop'
${WINDOWS_PARENTS_SCRIPT}
$rows = @(foreach ($ownerId in $parents.Keys) {
  $start = $null; $startedAt = $null; $rss = $null; $cpu = $null
  if (@(${pids.join(',')}) -contains $ownerId) {
    try {
      $p = Get-Process -Id $ownerId -ErrorAction Stop
      try { $start = [string]$p.StartTime.ToUniversalTime().Ticks } catch {}
      try { $startedAt = $p.StartTime.ToUniversalTime().ToString('o') } catch {}
      try { $rss = $p.WorkingSet64 } catch {}
      try { $cpu = $p.TotalProcessorTime.TotalSeconds } catch {}
    } catch {}
  }
  [pscustomobject]@{ pid = $ownerId; ppid = $parents[$ownerId]; processStartId = $start; startedAt = $startedAt; rssBytes = $rss; cpuSeconds = $cpu }
})
ConvertTo-Json -InputObject $rows -Compress
`
    const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true, signal, killSignal: 'SIGKILL'
    })
    return parseWindowsProcesses(stdout)
  }
  if (platform !== 'darwin' && platform !== 'linux') throw new Error('Unsupported platform')
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,rss=,time=,lstart=,comm='], {
    timeout: 5000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, signal, killSignal: 'SIGKILL'
  })
  return parsePs(stdout)
}

export function parseWindowsProcesses(output: string): Map<number, ProcessInfo> {
  const rows: unknown = JSON.parse(output.replace(/^\uFEFF/, ''))
  if (!Array.isArray(rows)) throw new Error('Invalid process payload')
  const result = new Map<number, ProcessInfo>()
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.pid) || row.pid < 0
      || !Number.isSafeInteger(row.ppid) || row.ppid < 0) throw new Error('Invalid process payload')
    result.set(row.pid, {
      pid: row.pid, ppid: row.ppid,
      processStartId: typeof row.processStartId === 'string' && /^\d{1,20}$/.test(row.processStartId) ? row.processStartId : null,
      startedAt: normalizeStartedAt(row.startedAt),
      rssBytes: Number.isSafeInteger(row.rssBytes) && row.rssBytes >= 0 ? row.rssBytes : null,
      cpuSeconds: typeof row.cpuSeconds === 'number' && Number.isFinite(row.cpuSeconds) && row.cpuSeconds >= 0 ? row.cpuSeconds : null
    })
  }
  return result
}

export function normalizeStartedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function protectedPids(rows: Map<number, ProcessInfo>, ownPid = process.pid, parentPid = process.ppid): Set<number> | null {
  const protectedIds = new Set([0, 1, ownPid, parentPid])
  let pid = ownPid
  const seen = new Set<number>()
  while (pid > 1) {
    if (seen.has(pid)) return null
    seen.add(pid)
    const parent = rows.get(pid)?.ppid
    if (parent === undefined || parent === null || (pid === ownPid && parent !== parentPid)) return null
    protectedIds.add(parent)
    pid = parent
  }
  return protectedIds
}

export function createMetricsSampler() {
  let previous = new Map<number, { start: string; cpu: number; at: number }>()
  return (rows: Map<number, ProcessInfo>, now = performance.now()) => {
    const next = new Map<number, { start: string; cpu: number; at: number }>()
    const metrics = new Map<number, ObservedService['metrics']>()
    for (const row of rows.values()) {
      const last = previous.get(row.pid)
      let cpuPercent: number | null = null
      if (row.processStartId !== null && row.cpuSeconds !== null) {
        if (last?.start === row.processStartId && now > last.at && row.cpuSeconds >= last.cpu) {
          cpuPercent = (row.cpuSeconds - last.cpu) * 100000 / (now - last.at)
        }
        next.set(row.pid, { start: row.processStartId, cpu: row.cpuSeconds, at: now })
      }
      metrics.set(row.pid, { rssBytes: row.rssBytes, cpuPercent })
    }
    previous = next
    return metrics
  }
}

export interface StopTarget { pid: number; processStartId: string }
type StopSelection = StopTarget & { supervisor?: StopTarget }
type StopService = Pick<ObservedService, 'pid' | 'processStartId' | 'stopSupervisor'>
export interface StopRequest { targets: StopSelection[]; force: boolean }
export type StopStatus = 'signal-sent' | 'already-exited' | 'identity-changed' | 'protected' | 'not-observed' | 'permission-denied' | 'unsupported' | 'failed'

export function findStopSupervisors(rows: Map<number, ProcessInfo>, listenerPids: Set<number>, protectedIds: Set<number> | null) {
  const supervisors = new Map<number, StopTarget>()
  const uid = process.getuid?.()
  if (!protectedIds || uid === undefined || uid === 0) return supervisors

  const childCounts = new Map<number, number>()
  for (const row of rows.values()) {
    if (row.ppid !== null) childCounts.set(row.ppid, (childCounts.get(row.ppid) ?? 0) + 1)
  }
  for (const pid of listenerPids) {
    const child = rows.get(pid)
    const parent = child?.ppid == null ? undefined : rows.get(child.ppid)
    // Only offer a dedicated, same-user Node parent, never a shell, shared launcher or listener.
    if (child?.executable !== 'node' || !parent?.processStartId || parent.executable !== 'node'
      || child.uid !== uid || parent.uid !== uid || !child.pgid || child.pgid !== parent.pgid
      || childCounts.get(parent.pid) !== 1 || listenerPids.has(parent.pid)
      || protectedIds.has(pid) || protectedIds.has(parent.pid)) continue
    supervisors.set(pid, { pid: parent.pid, processStartId: parent.processStartId })
  }
  return supervisors
}

function parseStopIdentity(target: unknown): StopTarget {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('Invalid stop target')
  const { pid, processStartId } = target as Record<string, unknown>
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1
    || typeof processStartId !== 'string' || !processStartId.trim() || processStartId.length > 128
    || /[\x00-\x1f\x7f]/.test(processStartId)) throw new Error('Invalid stop target')
  return { pid, processStartId }
}

export function parseStopRequest(value: unknown): StopRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stop request')
  const body = value as Record<string, unknown>
  if (typeof body.force !== 'boolean' || !Array.isArray(body.targets) || !body.targets.length || body.targets.length > 100) throw new Error('Invalid stop request')
  const pids = new Set<number>()
  const targets = body.targets.map((value: unknown): StopSelection => {
    const target = parseStopIdentity(value)
    if (pids.has(target.pid)) throw new Error('Invalid stop target')
    pids.add(target.pid)
    const supervisor = (value as Record<string, unknown>).supervisor
    if (supervisor === undefined) return target
    const parent = parseStopIdentity(supervisor)
    if (parent.pid === target.pid) throw new Error('Invalid supervisor')
    return { ...target, supervisor: parent }
  })
  return { targets, force: body.force }
}

export interface OpenRequest extends StopTarget { destination: 'folder' | 'editor' }

export function parseOpenRequest(value: unknown): OpenRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid open request')
  const body = value as Record<string, unknown>
  const target = parseStopIdentity(body)
  if (body.destination !== 'folder' && body.destination !== 'editor') throw new Error('Invalid open request')
  return { ...target, destination: body.destination }
}

export class ProcessOpenError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export async function openProcess(
  request: OpenRequest,
  observed: Pick<ObservedService, 'pid' | 'processStartId' | 'project' | 'cwd'>[],
  dependencies: {
    inspect?: typeof inspectProcesses
    execute?: (file: string, args: string[]) => Promise<unknown>
    platform?: NodeJS.Platform
  } = {}
): Promise<{ opened: true }> {
  const service = observed.find(row => row.pid === request.pid && row.processStartId === request.processStartId)
  if (!service) throw new ProcessOpenError(409, 'Process identity is stale. Refresh the inventory.')
  const platform = dependencies.platform ?? process.platform
  let current
  try { current = await (dependencies.inspect ?? inspectProcesses)([request.pid], platform) }
  catch { throw new ProcessOpenError(503, 'Process identity could not be checked.') }
  if (current.get(request.pid)?.processStartId !== request.processStartId) {
    throw new ProcessOpenError(409, 'Process identity changed or the process exited. Refresh the inventory.')
  }
  const path = [service.project?.worktree, service.project?.root, service.cwd].find(path => typeof path === 'string' && isAbsolute(path))
  if (!path) throw new ProcessOpenError(404, 'No known project or working directory is available.')
  let directory
  try {
    directory = await realpath(path)
    if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory')
    await access(directory, constants.R_OK)
  } catch { throw new ProcessOpenError(404, 'The known directory is no longer accessible.') }
  let file: string
  let args: string[]
  if (platform === 'darwin') {
    file = '/usr/bin/open'
    args = request.destination === 'folder' ? [directory] : ['-a', 'Visual Studio Code', directory]
  } else if (platform === 'linux') {
    file = request.destination === 'folder' ? 'xdg-open' : 'code'
    args = request.destination === 'folder' ? [directory] : ['--', directory]
  } else if (platform === 'win32') {
    file = 'explorer.exe'
    if (request.destination === 'editor') {
      file = 'Code.exe'
      for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
        if (!root) continue
        const candidate = join(root, 'Microsoft VS Code', 'Code.exe')
        if (await access(candidate).then(() => true, () => false)) { file = candidate; break }
      }
    }
    args = request.destination === 'folder' ? [directory] : ['--', directory]
  } else throw new ProcessOpenError(503, 'Opening directories is not supported on this platform.')
  try {
    if (dependencies.execute) await dependencies.execute(file, args)
    else if (platform === 'win32') {
      // Windows GUI executables can stay alive; acknowledge launch without timing out and killing the opened app.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(file, args, { windowsHide: true, detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    } else await exec(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 })
  } catch {
    throw new ProcessOpenError(503, request.destination === 'editor' ? 'Could not open Visual Studio Code. Check that it is installed and available.' : 'Could not open the system file explorer.')
  }
  return { opened: true }
}

export async function stopProcesses(
  request: StopRequest,
  observed: StopService[],
  dependencies: {
    fresh: () => Promise<{ services: StopService[]; processes: Map<number, ProcessInfo> }>
    inspect?: typeof inspectProcesses
    signal?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
    invalidate: () => void
    platform?: NodeJS.Platform
  }
) {
  const platform = dependencies.platform ?? process.platform
  const snapshot = await dependencies.fresh()
  const ancestors = protectedPids(snapshot.processes)
  const listenerPids = new Set(snapshot.services.flatMap(row => row.pid === null ? [] : [row.pid]))
  const send = dependencies.signal ?? process.kill
  const signal = request.force ? 'SIGKILL' : 'SIGTERM'
  const results: (StopTarget & { status: StopStatus })[] = []
  for (const target of request.targets) {
    const original = observed.find(row => row.pid === target.pid)
    const fresh = snapshot.services.find(row => row.pid === target.pid)
    const supervisor = target.supervisor
    let status: StopStatus
    if (!ancestors || ancestors.has(target.pid)) status = 'protected'
    else if (!original) status = 'not-observed'
    else if (original.processStartId !== target.processStartId) status = 'identity-changed'
    else if (!fresh) {
      status = snapshot.processes.has(target.pid) ? 'not-observed' : 'already-exited'
    } else if (fresh.processStartId !== target.processStartId) status = 'identity-changed'
    else if (platform === 'win32' && !request.force) status = 'unsupported'
    else if (supervisor && (original.stopSupervisor?.pid !== supervisor.pid
      || original.stopSupervisor.processStartId !== supervisor.processStartId
      || fresh.stopSupervisor?.pid !== supervisor.pid
      || fresh.stopSupervisor.processStartId !== supervisor.processStartId)) status = 'identity-changed'
    else {
      try {
        const current = await (dependencies.inspect ?? inspectProcesses)([target.pid], platform)
        const protectedNow = protectedPids(current)
        if (!protectedNow || protectedNow.has(target.pid)) status = 'protected'
        else if (!current.has(target.pid)) status = 'already-exited'
        else if (current.get(target.pid)?.processStartId !== target.processStartId) status = 'identity-changed'
        else if (supervisor && platform === 'win32') status = 'unsupported'
        else {
          const currentSupervisor = supervisor && findStopSupervisors(current, listenerPids, protectedNow).get(target.pid)
          if (supervisor && (currentSupervisor?.pid !== supervisor.pid || currentSupervisor.processStartId !== supervisor.processStartId)) {
            status = 'identity-changed'
          } else {
            // shortcut: ps start IDs have second precision and inspection/signal is not atomic; use native process handles if stronger PID-reuse/TOCTOU guarantees are needed.
            try {
              let supervisorSignaled = false
              try {
                if (supervisor) {
                  send(supervisor.pid, signal)
                  supervisorSignaled = true
                }
                send(target.pid, signal)
                status = 'signal-sent'
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH' || !supervisor) throw error
                // The listener may already have exited in response to its parent's signal.
                status = supervisorSignaled ? 'signal-sent' : 'identity-changed'
              }
            } finally {
              dependencies.invalidate()
            }
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        status = code === 'ESRCH' ? 'already-exited' : code === 'EPERM' || code === 'EACCES' ? 'permission-denied' : 'failed'
      }
    }
    results.push({ pid: target.pid, processStartId: target.processStartId, status })
  }
  return { results }
}
