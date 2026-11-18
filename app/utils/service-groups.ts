import type { ObservedService } from '../../shared/types/inventory.ts'

export function groupServices(services: ObservedService[], homeDirectory: string | undefined) {
  const groups: { id: string, services: ObservedService[] }[] = []
  for (const service of services) {
    const isGroupable = Boolean(homeDirectory && service.cwd && service.cwd !== '/' && service.cwd !== homeDirectory)
    const prevGroup = groups[groups.length - 1]
    const dirPrefix = isGroupable ? `directory:${service.cwd}` : null

    if (dirPrefix && prevGroup && prevGroup.services[0]?.cwd === service.cwd) {
      prevGroup.services.push(service)
    } else {
      const id = dirPrefix ? `${dirPrefix}:${groups.length}` : `service:${service.id}`
      groups.push({ id, services: [service] })
    }
  }
  return groups
}
