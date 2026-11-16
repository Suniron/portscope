import { isIP } from 'node:net'
import type { ObservedService } from '../../shared/types/inventory.ts'

type Endpoint = ObservedService['endpoints'][number]
export interface Listener {
  pid: number | null
  processName: string | null
  endpoint: Endpoint
}

export function parseEndpoint(value: string): Endpoint | null {
  const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(value)
  if (!match) return null
  const address = match[1] ?? match[2]!
  const port = Number(match[3])
  if (port < 1 || port > 65535) return null
  const family = isIP(address.split('%')[0]!)
  return { address, port, family: family === 6 ? 'IPv6' : family === 4 ? 'IPv4' : null, url: null }
}

/** lsof's field output avoids whitespace-sensitive process-name columns. */
export function parseLsof(output: string): Listener[] {
  let pid: number | null = null
  let processName: string | null = null
  const listeners: Listener[] = []
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      pid = /^\d+$/.test(line.slice(1)) ? Number(line.slice(1)) : null
      processName = null
    } else if (line.startsWith('c')) {
      processName = line.slice(1) || null
    } else if (line.startsWith('n')) {
      const endpoint = parseEndpoint(line.slice(1))
      if (endpoint) listeners.push({ pid, processName, endpoint })
    }
  }
  return listeners
}

export function parseLsofCwds(output: string): Map<number, string> {
  const directories = new Map<number, string>()
  let pid: number | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = /^\d+$/.test(line.slice(1)) ? Number(line.slice(1)) : null
    else if (pid !== null && line.startsWith('n/')) directories.set(pid, line.slice(1))
  }
  return directories
}

/** ss -H -ltnp; process metadata can legitimately be absent. */
export function parseSs(output: string): Listener[] {
  const listeners: Listener[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const columns = line.trim().split(/\s+/)
    if (columns[0] !== 'LISTEN') continue
    const endpoint = parseEndpoint(columns[3] ?? '')
    if (!endpoint) continue
    const owners = [...line.matchAll(/\("([^"]*)",pid=(\d+),fd=\d+\)/g)]
    if (!owners.length) listeners.push({ pid: null, processName: null, endpoint })
    for (const owner of owners) {
      listeners.push({ pid: Number(owner[2]), processName: owner[1] || null, endpoint: { ...endpoint } })
    }
  }
  return listeners
}

export function groupListeners(listeners: Listener[]): ObservedService[] {
  const services = new Map<string, ObservedService>()
  for (const { pid, processName, endpoint } of listeners) {
    const id = pid === null
      ? `endpoint:${endpoint.address}:${endpoint.port}`
      : `pid:${pid}`
    let service = services.get(id)
    if (!service) {
      service = { id, pid, processName, cwd: null, project: null, endpoints: [] }
      services.set(id, service)
    }
    if (!service.endpoints.some(e => e.address === endpoint.address && e.port === endpoint.port)) {
      service.endpoints.push({ ...endpoint })
    }
  }
  return [...services.values()].map(service => ({
    ...service,
    endpoints: service.endpoints.sort((a, b) => a.port - b.port || a.address.localeCompare(b.address))
  })).sort((a, b) => a.endpoints[0]!.port - b.endpoints[0]!.port || a.id.localeCompare(b.id))
}
