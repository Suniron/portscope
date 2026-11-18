import type { ObservedService } from '#shared/types/inventory'

export type SortField = 'port' | 'name' | 'duration' | 'cpu' | 'ram'
export type SortOrder = 'asc' | 'desc'
export type StopStatus =
  | 'signal-sent'
  | 'already-exited'
  | 'identity-changed'
  | 'protected'
  | 'not-observed'
  | 'permission-denied'
  | 'unsupported'
  | 'failed'

export interface ProcessStopTarget {
  pid: number
  processStartId: string
}

export interface StopResultItem {
  pid: number
  processStartId: string
  status: StopStatus
}

export function formatDuration(startedAt: string | null | undefined, nowMs: number): string {
  if (!startedAt) return '—'
  const startedMs = Date.parse(startedAt)
  if (Number.isNaN(startedMs)) return '—'
  const diffSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  if (diffSec < 60) return `${diffSec} s`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min`

  const diffHours = Math.floor(diffMin / 60)
  const remMin = diffMin % 60
  if (diffHours < 24) {
    return remMin > 0 ? `${diffHours} h ${remMin} min` : `${diffHours} h`
  }

  const days = Math.floor(diffHours / 24)
  const remHours = diffHours % 24
  return remHours > 0 ? `${days} j ${remHours} h` : `${days} j`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) return '—'
  const mebi = bytes / (1024 * 1024)
  if (bytes < 1024 * 1024) {
    return bytes === 0 ? '0 Mo' : '< 1 Mo'
  }
  if (bytes < 1024 * 1024 * 1024) {
    if (mebi >= 100) return `${Math.round(mebi)} Mo`
    return `${mebi.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} Mo`
  }
  const gibi = bytes / (1024 * 1024 * 1024)
  return `${gibi.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Go`
}

export function formatCpu(cpuPercent: number | null | undefined): string {
  if (cpuPercent === null || cpuPercent === undefined || typeof cpuPercent !== 'number' || Number.isNaN(cpuPercent)) {
    return '—'
  }
  return `${cpuPercent.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

export function getStopDisabledReason(service: ObservedService): 'protected' | 'identity-unavailable' | null {
  if (service.stopDisabledReason === 'protected') return 'protected'
  if (service.stopDisabledReason === 'identity-unavailable') return 'identity-unavailable'
  if (service.pid === null || !service.processStartId) return 'identity-unavailable'
  return null
}

export function isStopEligible(service: ObservedService): boolean {
  return getStopDisabledReason(service) === null
}

export function getServiceTargetKey(service: Pick<ObservedService, 'pid' | 'processStartId'>): string | null {
  if (service.pid === null || !service.processStartId) return null
  return `${service.pid}:${service.processStartId}`
}

export function pruneSelection(selectedKeys: Set<string>, visibleServices: ObservedService[]): Set<string> {
  const next = new Set<string>()
  const validKeys = new Set<string>()
  for (const service of visibleServices) {
    if (isStopEligible(service)) {
      const key = getServiceTargetKey(service)
      if (key) validKeys.add(key)
    }
  }
  for (const key of selectedKeys) {
    if (validKeys.has(key)) {
      next.add(key)
    }
  }
  return next
}

export function extractStopTargets(selectedKeys: Set<string>, services: ObservedService[]): ProcessStopTarget[] {
  const map = new Map<string, ProcessStopTarget>()
  for (const service of services) {
    if (isStopEligible(service)) {
      const key = getServiceTargetKey(service)
      if (key && selectedKeys.has(key) && !map.has(key) && service.pid !== null && service.processStartId) {
        map.set(key, { pid: service.pid, processStartId: service.processStartId })
      }
    }
  }
  return [...map.values()]
}

export function filterServices(
  services: ObservedService[],
  query: string,
  onlyWithGit: boolean,
): ObservedService[] {
  const search = query.trim().toLocaleLowerCase()
  return services.filter((service) => {
    if (onlyWithGit && !service.project?.branch && !service.project?.worktree) {
      return false
    }
    if (!search) return true
    const haystack = [
      service.processName,
      service.pid,
      service.cwd,
      service.project?.name,
      service.project?.root,
      service.project?.branch,
      service.project?.worktree,
      ...service.endpoints.map(e => `${e.address}:${e.port}`),
    ].join(' ').toLocaleLowerCase()
    return haystack.includes(search)
  })
}

function serviceMinPort(service: ObservedService): number {
  if (!service.endpoints.length) return Number.POSITIVE_INFINITY
  return Math.min(...service.endpoints.map(e => e.port))
}

function serviceSortName(service: ObservedService): string {
  return service.project?.name ?? service.processName ?? ''
}

export function sortServices(
  services: ObservedService[],
  sortBy: SortField,
  sortOrder: SortOrder,
): ObservedService[] {
  const multiplier = sortOrder === 'asc' ? 1 : -1
  return [...services].sort((a, b) => {
    if (sortBy === 'cpu' || sortBy === 'ram') {
      const metric = sortBy === 'cpu' ? 'cpuPercent' : 'rssBytes'
      const valueA = a.metrics?.[metric] ?? NaN
      const valueB = b.metrics?.[metric] ?? NaN
      const validA = Number.isFinite(valueA)
      const validB = Number.isFinite(valueB)
      if (!validA && !validB) return 0
      if (!validA) return 1
      if (!validB) return -1
      return (valueA - valueB) * multiplier
    }
    if (sortBy === 'port') {
      const diff = serviceMinPort(a) - serviceMinPort(b)
      return diff !== 0 ? diff * multiplier : 0
    }
    if (sortBy === 'name') {
      const nameA = serviceSortName(a)
      const nameB = serviceSortName(b)
      const comp = nameA.localeCompare(nameB, 'fr-FR', { sensitivity: 'base' })
      return comp !== 0 ? comp * multiplier : 0
    }
    if (sortBy === 'duration') {
      const timeA = a.startedAt ? Date.parse(a.startedAt) : Number.NaN
      const timeB = b.startedAt ? Date.parse(b.startedAt) : Number.NaN
      const validA = !Number.isNaN(timeA)
      const validB = !Number.isNaN(timeB)
      if (!validA && !validB) return 0
      if (!validA) return 1
      if (!validB) return -1
      // For duration: larger duration = earlier start time (smaller timestamp).
      // asc: shortest running first (most recent start time => larger timestamp first)
      // desc: longest running first (earliest start time => smaller timestamp first)
      const diff = sortOrder === 'asc' ? timeB - timeA : timeA - timeB
      return diff
    }
    return 0
  })
}

export function getCheckboxAriaLabel(service: ObservedService): string {
  const name = service.project?.name ?? service.processName ?? 'processus'
  const pid = service.pid !== null ? `PID ${service.pid}` : ''
  return `Sélectionner ${name} ${pid}`.trim()
}

export function describeStopStatus(status: StopStatus): {
  label: string
  severity: 'success' | 'warning' | 'error' | 'info'
  isExitOrSignal: boolean
  actionHint?: string
} {
  switch (status) {
    case 'signal-sent':
      return { label: 'Signal d’arrêt envoyé', severity: 'success', isExitOrSignal: true }
    case 'already-exited':
      return { label: 'Processus déjà arrêté', severity: 'success', isExitOrSignal: true }
    case 'identity-changed':
      return { label: 'Identité modifiée (PID réutilisé)', severity: 'warning', isExitOrSignal: false }
    case 'protected':
      return { label: 'Processus protégé (système ou Portscope)', severity: 'warning', isExitOrSignal: false }
    case 'not-observed':
      return { label: 'Processus non observé en écoute', severity: 'warning', isExitOrSignal: false }
    case 'permission-denied':
      return { label: 'Droits insuffisants pour arrêter ce processus', severity: 'error', isExitOrSignal: false }
    case 'unsupported':
      return {
        label: 'Arrêt normal non pris en charge sur ce système',
        severity: 'warning',
        isExitOrSignal: false,
        actionHint: 'Activez l’option « Forcer l’arrêt » pour ce processus sous Windows.',
      }
    case 'failed':
    default:
      return { label: 'Échec de la commande d’arrêt', severity: 'error', isExitOrSignal: false }
  }
}
