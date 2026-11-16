import type { ObservedService } from '#shared/types/inventory'

export function httpAttemptUrl(endpoint: Pick<ObservedService['endpoints'][number], 'address' | 'port' | 'family'>): string | undefined {
  let address = endpoint.address
  if (address === '*') address = endpoint.family === 'IPv6' ? '::1' : '127.0.0.1'
  else if (address === '0.0.0.0') address = '127.0.0.1'
  else if (address === '::') address = '::1'
  if (address === '::1') address = 'localhost'
  const host = address.includes(':') ? `[${address}]` : address
  const url = `http://${host}:${endpoint.port}`
  return URL.canParse(url) ? url : undefined
}
