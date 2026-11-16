import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertNotRoot, parsePort, serverEnvironment } from './config.mjs'

export async function checkPort(port) {
  const probe = createServer()
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject)
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
    })
  } catch (error) {
    const code = error?.code
    const detail = code === 'EADDRINUSE' ? 'already in use'
      : code === 'EACCES' || code === 'EPERM' ? 'not permitted for this user' : 'unavailable'
    throw new Error(`Port ${port} is ${detail}. Set PORTSCOPE_PORT to an available unprivileged port; do not use sudo.`)
  } finally {
    if (probe.listening) await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  }
}

export async function start(args = process.argv.slice(2)) {
  assertNotRoot()
  if (args.some(arg => arg !== '--dev') || args.length > 1) throw new Error('Usage: pnpm start | pnpm dev (set PORTSCOPE_PORT to choose a port).')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const port = parsePort(process.env.PORTSCOPE_PORT)
  const dev = args.includes('--dev')
  if (!dev) {
    try { await access(new URL('../.output/server/index.mjs', import.meta.url)) }
    catch { throw new Error('Production build not found. Run pnpm build before pnpm start.') }
  }
  await checkPort(port)
  Object.assign(process.env, serverEnvironment(process.env, port))
  if (!dev) {
    await import(new URL('../.output/server/index.mjs', import.meta.url).href)
    return
  }
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url)),
    'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--no-fork'
  ], { cwd: root, env: process.env, stdio: 'inherit' })
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  child.once('error', () => { console.error('Could not start Nuxt. Run pnpm install first.'); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(error => { console.error(error.message); process.exitCode = 1 })
}
