import type { ObservedService } from '../../shared/types/inventory.ts'

export function groupServices(services: ObservedService[], homeDirectory: string | undefined) {
  const groups = new Map<string, { id: string, services: ObservedService[] }>()
  for (const service of services) {
    const grouped = homeDirectory && service.cwd && service.cwd !== '/' && service.cwd !== homeDirectory
    const id = grouped ? `directory:${service.cwd}` : `service:${service.id}`
    let group = groups.get(id)
    if (!group) {
      group = { id, services: [] }
      groups.set(id, group)
    }
    group.services.push(service)
  }
  return [...groups.values()]
}
