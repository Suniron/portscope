import { isIP } from 'node:net'
import type { Listener } from './parsers.ts'

// Constant script: only listener endpoints, owner IDs and names cross the boundary.
export const WINDOWS_LISTENERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$connections = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' })
$names = @{}
$rows = @(foreach ($connection in $connections) {
  $ownerId = [long]$connection.OwningProcess
  if (-not $names.ContainsKey($ownerId)) {
    $names[$ownerId] = $null
    try {
      $names[$ownerId] = (Get-Process -Id $ownerId -ErrorAction Stop).ProcessName
    } catch {}
  }
  [pscustomobject]@{
    pid = $ownerId
    processName = $names[$ownerId]
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
      endpoint: { address: row.address, port: row.port, family: isIP(row.address) === 6 ? 'IPv6' : 'IPv4', url: null }
    }
  })
}
