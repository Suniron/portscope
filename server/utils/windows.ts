import { isIP } from 'node:net'
import type { Listener } from './parsers.ts'
import { normalizeStartedAt } from './processes.ts'

// Constant script: only listener endpoints and bounded process identity/metrics cross the boundary.
export const WINDOWS_LISTENERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$connections = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' })
$names = @{}
$metadata = @{}
$rows = @(foreach ($connection in $connections) {
  $ownerId = [long]$connection.OwningProcess
  if (-not $names.ContainsKey($ownerId)) {
    $names[$ownerId] = $null
    $metadata[$ownerId] = @{ start = $null; startedAt = $null; rss = $null; cpu = $null }
    try {
      $p = Get-Process -Id $ownerId -ErrorAction Stop
      $names[$ownerId] = $p.ProcessName
      try { $metadata[$ownerId].start = [string]$p.StartTime.ToUniversalTime().Ticks } catch {}
      try { $metadata[$ownerId].startedAt = $p.StartTime.ToUniversalTime().ToString('o') } catch {}
      try { $metadata[$ownerId].rss = $p.WorkingSet64 } catch {}
      try { $metadata[$ownerId].cpu = $p.TotalProcessorTime.TotalSeconds } catch {}
    } catch {}
  }
  [pscustomobject]@{
    pid = $ownerId
    processName = $names[$ownerId]
    processStartId = $metadata[$ownerId].start
    startedAt = $metadata[$ownerId].startedAt
    rssBytes = $metadata[$ownerId].rss
    cpuSeconds = $metadata[$ownerId].cpu
    address = [string]$connection.LocalAddress
    port = [int]$connection.LocalPort
  }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
`

export function parseWindowsListeners(output: string): Listener[] {
  const rows: unknown = JSON.parse(output.replace(/^\uFEFF/, ''))
  if (!Array.isArray(rows)) throw new Error('Invalid Windows listener payload.')
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !Number.isSafeInteger(row.pid) || row.pid < 0
      || !Number.isSafeInteger(row.port) || row.port < 1 || row.port > 65535
      || typeof row.address !== 'string' || !isIP(row.address)
      || (row.processName !== null && typeof row.processName !== 'string')) {
      throw new Error('Invalid Windows listener payload.')
    }
    return {
      pid: row.pid,
      processName: row.processName,
      process: {
        pid: row.pid, ppid: null,
        processStartId: typeof row.processStartId === 'string' && /^\d{1,20}$/.test(row.processStartId) ? row.processStartId : null,
        startedAt: normalizeStartedAt(row.startedAt),
        rssBytes: Number.isSafeInteger(row.rssBytes) && row.rssBytes >= 0 ? row.rssBytes : null,
        cpuSeconds: typeof row.cpuSeconds === 'number' && Number.isFinite(row.cpuSeconds) && row.cpuSeconds >= 0 ? row.cpuSeconds : null
      },
      endpoint: { address: row.address, port: row.port, family: isIP(row.address) === 6 ? 'IPv6' : 'IPv4', url: null }
    }
  })
}
