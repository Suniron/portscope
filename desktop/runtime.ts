import { createServer } from 'node:http'
import { delimiter, join } from 'node:path'
import { assertNotRoot } from '../scripts/config.mjs'

export async function startDesktopServer(entrypoint: URL) {
  assertNotRoot()
  // Desktop launchers need not inherit a shell PATH; Git remains optional.
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const systemPaths = process.platform === 'win32'
    ? [join(systemRoot, 'System32'), join(systemRoot, 'System32/WindowsPowerShell/v1.0')]
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  process.env.PATH = [...new Set([
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...systemPaths
  ])].join(delimiter)
  const { listener } = await import(entrypoint.href)
  if (typeof listener !== 'function') throw new Error('The packaged Nuxt HTTP listener is missing.')
  const server = createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Portscope could not obtain its loopback port.')
  }
  process.env.PORTSCOPE_PORT = String(address.port)
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

export function navigationRules(origin: string): string {
  const url = new URL(origin)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== origin) {
    throw new Error('Portscope requires an exact loopback HTTP origin.')
  }
  // Electrobun uses ordered glob rules: deny all, then allow our exact origin.
  return JSON.stringify(['^*', `${origin}/*`])
}

export function externalUrl(detail: unknown): string | null {
  const value = typeof detail === 'string'
    ? detail
    : detail && typeof detail === 'object' && 'url' in detail ? detail.url : null
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
