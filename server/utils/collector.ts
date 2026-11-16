import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Inventory, ObservedService } from '../../shared/types/inventory.ts'
import { groupListeners, parseLsof, parseLsofCwds, parseSs } from './parsers.ts'
import { branchWebUrl } from './branch-url.ts'

const exec = promisify(execFile)
const commandOptions = { timeout: 5000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' as const }

export class CollectionError extends Error {
  constructor() {
    super('Local inventory is unavailable. Install lsof (macOS/Linux) or ss (Linux), and check process permissions.')
  }
}

async function listeners(platform: string, signal?: AbortSignal) {
  if (platform !== 'darwin' && platform !== 'linux') throw new CollectionError()
  if (platform === 'linux') {
    try {
      const result = await exec('ss', ['-H', '-ltnp'], { ...commandOptions, signal, killSignal: 'SIGKILL' })
      const parsed = parseSs(result.stdout)
      if (result.stdout.trim() && !parsed.length) throw new CollectionError()
      return { listeners: parsed, warnings: result.stderr.trim() ? ['Some listener metadata could not be read.'] : [] }
    } catch {
      // lsof is the fallback when ss is missing or cannot collect listeners.
    }
  }
  try {
    signal?.throwIfAborted()
    let result
    try {
      result = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { ...commandOptions, signal, killSignal: 'SIGKILL' })
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      // lsof uses exit 1 for a successful query with no matches.
      if (failure.code === 1 && !failure.stdout?.trim() && !failure.stderr?.trim()) {
        return { listeners: [], warnings: [] }
      }
      throw error
    }
    const parsed = parseLsof(result.stdout)
    if (result.stdout.trim() && !parsed.length) throw new CollectionError()
    return {
      listeners: parsed,
      warnings: result.stderr.trim() ? ['Some listeners may be unavailable to the current user.'] : []
    }
  } catch {
    throw new CollectionError()
  }
}

async function linuxCwd(pid: number, signal: AbortSignal): Promise<string | null> {
  try {
    signal.throwIfAborted()
    const cwd = await readlink(`/proc/${pid}/cwd`)
    signal.throwIfAborted()
    return cwd
  } catch {
    return null
  }
}

async function macCwds(services: ObservedService[], signal?: AbortSignal) {
  const pids = services.map(service => service.pid).filter(pid => pid !== null)
  if (!pids.length) return new Map<number, string>()
  try {
    const { stdout } = await exec('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], {
      ...commandOptions, timeout: 3000, signal, killSignal: 'SIGKILL'
    })
    return parseLsofCwds(stdout)
  } catch {
    return new Map<number, string>()
  }
}

async function git(cwd: string, args: string[], signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { stdout } = await exec('git', ['--no-optional-locks', '-C', cwd, ...args], {
    ...commandOptions, timeout: 2000, signal, killSignal: 'SIGKILL',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  })
  return stdout.trim()
}

async function manifestName(directory: string, signal?: AbortSignal): Promise<string | null> {
  let file
  try {
    signal?.throwIfAborted()
    // O_NONBLOCK also protects against replacement by a FIFO before open.
    file = await open(resolve(directory, 'package.json'), constants.O_RDONLY | constants.O_NONBLOCK)
    signal?.throwIfAborted()
    const info = await file.stat()
    signal?.throwIfAborted()
    const maxBytes = 256 * 1024
    if (!info.isFile() || info.size > maxBytes) return null
    const chunks: Buffer[] = []
    const stream = file.createReadStream({ start: 0, end: maxBytes, autoClose: false, signal })
    for await (const chunk of stream) chunks.push(chunk)
    const data = Buffer.concat(chunks)
    if (data.length > maxBytes) return null
    const manifest = JSON.parse(data.toString('utf8'))
    return typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : null
  } catch {
    return null
  } finally {
    await file?.close().catch(() => {})
  }
}

async function upstreamBranchUrl(cwd: string, branch: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const remote = await git(cwd, ['config', '--get', `branch.${branch}.remote`], signal)
    if (!remote || remote === '.') return null
    const merge = await git(cwd, ['config', '--get', `branch.${branch}.merge`], signal)
    // Require an existing local tracking ref, not just a guessed published branch.
    await git(cwd, ['rev-parse', '--verify', '@{upstream}'], signal)
    const remoteUrl = await git(cwd, ['remote', 'get-url', '--', remote], signal)
    return branchWebUrl(remoteUrl, merge)
  } catch {
    return null
  }
}

export async function projectContext(cwd: string, signal?: AbortSignal): Promise<ObservedService['project']> {
  try {
    const root = await git(cwd, ['rev-parse', '--show-toplevel'], signal)
    const branch = await git(cwd, ['symbolic-ref', '--short', 'HEAD'], signal)
      .catch(() => git(cwd, ['rev-parse', '--short', 'HEAD'], signal).catch(() => ''))
    const common = await git(cwd, ['rev-parse', '--git-common-dir'], signal)
    const directory = await git(cwd, ['rev-parse', '--git-dir'], signal)
    signal?.throwIfAborted()
    const commonPath = await realpath(isAbsolute(common) ? common : resolve(cwd, common))
    signal?.throwIfAborted()
    const gitPath = await realpath(isAbsolute(directory) ? directory : resolve(cwd, directory))
    signal?.throwIfAborted()
    return {
      root, name: await manifestName(root, signal) ?? basename(root),
      branch: branch || null, branchUrl: branch ? await upstreamBranchUrl(cwd, branch, signal) : null,
      worktree: commonPath === gitPath ? null : root
    }
  } catch {
    // A manifest is evidence of a project even when it is not a Git checkout.
    let directory = cwd
    for (let depth = 0; depth < 8; depth++) {
      if (signal?.aborted) return null
      const name = await manifestName(directory, signal)
      if (name) return { root: directory, name, branch: null, branchUrl: null, worktree: null }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return null
  }
}

export function identifyOwnEndpoint(service: ObservedService, ownPid = process.pid): void {
  if (service.pid !== ownPid) return
  for (const endpoint of service.endpoints) {
    // Only our own HTTP server is known. No probes or port-based guesses.
    if (endpoint.address === '127.0.0.1' || endpoint.address === '::1') {
      endpoint.url = `http://${endpoint.family === 'IPv6' ? '[::1]' : '127.0.0.1'}:${endpoint.port}`
    }
  }
}

type Metadata = Pick<ObservedService, 'cwd' | 'project'>
let metadataWorkers = 0

export async function enrichServices(
  services: ObservedService[],
  inspect: (service: ObservedService, signal: AbortSignal) => Promise<Metadata>,
  parentSignal?: AbortSignal,
  timeoutMs = 6000
): Promise<boolean> {
  const controller = new AbortController()
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let index = 0
  let skipped = false
  const workers = Math.max(0, 2 - metadataWorkers)
  // Non-cancellable FS calls retain their slots after timeout, across refreshes.
  const work = Promise.all(Array.from({ length: workers }, async () => {
    metadataWorkers++
    try {
      while (index < services.length && !signal.aborted) {
        const position = index++
        const service = services[position]!
        if (service.pid === null) continue
        if (position >= 96) { skipped = true; continue }
        try {
          const metadata = await inspect(service, signal)
          if (!signal.aborted) Object.assign(service, metadata)
        } catch {
          skipped = true
        }
      }
    } finally {
      metadataWorkers--
    }
  }))
  let aborted: (() => void) | undefined
  try {
    await Promise.race([
      work,
      new Promise<void>(resolve => {
        aborted = () => resolve()
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', aborted, { once: true })
      })
    ])
    return !signal.aborted && !skipped && index >= services.length
  } finally {
    clearTimeout(timer)
    if (aborted) signal.removeEventListener('abort', aborted)
  }
}

export async function collectInventory(signal?: AbortSignal): Promise<Inventory> {
  const platform = process.platform
  const result = await listeners(platform, signal)
  const services = groupListeners(result.listeners)
  const directories = platform === 'darwin' ? await macCwds(services.slice(0, 96), signal) : null
  for (const service of services) identifyOwnEndpoint(service)
  // Limit metadata work, never the list of visible endpoints.
  const projects = new Map<string, Promise<ObservedService['project']>>()
  const complete = await enrichServices(services, async (service, signal) => {
    const cwd = directories ? directories.get(service.pid!) ?? null : await linuxCwd(service.pid!, signal)
    let project: ObservedService['project'] = null
    if (cwd && !signal.aborted) {
      if (!projects.has(cwd)) projects.set(cwd, projectContext(cwd, signal))
      project = await projects.get(cwd)!
    }
    return { cwd, project }
  }, signal)
  const warnings = [...result.warnings]
  if (services.some(s => s.pid === null || s.cwd === null)) {
    warnings.push('Some process or project metadata is unavailable to the current user; those services remain visible.')
  }
  if (!complete) warnings.push('Metadata collection was bounded to keep refresh responsive; some project context is unknown.')
  return { collectedAt: new Date().toISOString(), platform, services, warnings }
}

export function createInventoryCache(collect: (signal: AbortSignal) => Promise<Inventory>, ttl = 5000, timeoutMs = 20000) {
  let pending: Promise<Inventory> | undefined
  let expiresAt = 0
  let activeCollections = 0
  return () => {
    if (!pending || Date.now() >= expiresAt) {
      // Permit recovery from one stuck collector, but never accumulate retries.
      if (activeCollections >= 2) {
        expiresAt = Date.now() + ttl
        pending = Promise.reject(new CollectionError())
        return pending
      }
      expiresAt = Infinity
      const controller = new AbortController()
      activeCollections++
      let work: Promise<Inventory>
      try { work = Promise.resolve(collect(controller.signal)) }
      catch (error) { work = Promise.reject(error) }
      work = work.finally(() => { activeCollections-- })
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<Inventory>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new CollectionError()) }, timeoutMs)
      })
      pending = Promise.race([work, timeout]).finally(() => {
        clearTimeout(timer)
        expiresAt = Date.now() + ttl
      })
    }
    return pending
  }
}

export const getInventory = createInventoryCache(collectInventory)
