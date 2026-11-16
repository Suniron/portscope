export interface Inventory {
  collectedAt: string
  platform: string
  services: ObservedService[]
  warnings: string[]
}

export interface ObservedService {
  id: string
  pid: number | null
  processName: string | null
  cwd: string | null
  project: {
    root: string
    name: string
    branch: string | null
    branchUrl: string | null
    worktree: string | null
  } | null
  endpoints: {
    address: string
    port: number
    family: 'IPv4' | 'IPv6' | null
    url: string | null
  }[]
}
