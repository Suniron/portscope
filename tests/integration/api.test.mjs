import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

function startProcess(args, options, t) {
  const child = spawn(process.execPath, args, { cwd: root, ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    await exited
    clearTimeout(timer)
  })
  return { child, output: () => output }
}

async function waitForServer(server, port) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`Server failed: ${server.output()}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {}
    await delay(75)
  }
  throw new Error(`Server did not become ready: ${server.output()}`)
}

test('production API: live external listeners, unknown TCP, cache, security, bind failures', { timeout: 45000 }, async t => {
  await access(join(root, '.output/server/index.mjs'))
  const temp = await mkdtemp(join(tmpdir(), 'portscope-live-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const children = []
  for (const name of ['first-project', 'second-project']) {
    const cwd = join(temp, name)
    await mkdir(cwd)
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name }))
    const server = startProcess(['-e', `
      const net = require('node:net');
      const server = net.createServer(socket => socket.end('not HTTP'));
      server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    `], { cwd }, t)
    await once(server.child.stdout, 'data')
    children.push({ ...server, name })
  }
  const port = await freePort()
  const server = startProcess(['scripts/start.mjs'], {
    env: { ...process.env, PORTSCOPE_PORT: String(port), HOST: '0.0.0.0', NITRO_HOST: '::' }
  }, t)
  await waitForServer(server, port)
  const url = `http://127.0.0.1:${port}/api/inventory`
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  const inventory = await response.json()
  for (const external of children) {
    const observed = inventory.services.find(s => s.pid === external.child.pid)
    assert(observed, 'external service remains visible')
    assert.equal(observed.project?.name, external.name, JSON.stringify({ observed, warnings: inventory.warnings }))
    assert(observed.endpoints.every(e => e.url === null), 'arbitrary TCP must not be advertised as HTTP')
  }
  const own = inventory.services.find(s => s.pid === server.child.pid)
  assert(own)
  assert(own.endpoints.every(e => e.address === '127.0.0.1'), 'launcher must override unsafe binding environment')
  assert(own.endpoints.some(e => e.url === `http://127.0.0.1:${port}`))
  const cached = await Promise.all(Array.from({ length: 8 }, () => fetch(url).then(r => r.json())))
  assert(cached.every(value => value.collectedAt === inventory.collectedAt))
  for (const headers of [
    { Host: 'rebind.example' },
    { Origin: 'http://evil.example' },
    { Origin: 'null' },
    { Host: '127.0.0.1.evil.example' }
  ]) {
    // Node's fetch can replace Host; a raw HTTP request verifies rebinding protection.
    const status = await new Promise((resolve, reject) => {
      const req = request(url, { headers }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403, JSON.stringify(headers))
  }
  assert.equal((await fetch(url, { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200)

  // Local icon service works, but uninstalled icon collections cannot fetch upstream.
  const icon = await fetch(`http://127.0.0.1:${port}/api/_nuxt_icon/lucide.json?icons=radar`)
  assert.equal(icon.status, 200)
  assert.equal((await icon.json()).prefix, 'lucide')

  const duplicate = startProcess(['scripts/start.mjs'], {
    env: { ...process.env, PORTSCOPE_PORT: String(port) }
  }, t)
  const [code] = await once(duplicate.child, 'exit')
  assert.equal(code, 1)
  assert.match(duplicate.output(), /already in use.*PORTSCOPE_PORT/)

  const exited = once(children[0].child, 'exit')
  children[0].child.kill('SIGTERM')
  await exited
  await delay(5100)
  const updateResponse = await fetch(url)
  const updated = await updateResponse.json()
  assert.equal(updateResponse.status, 200, JSON.stringify(updated))
  assert(!updated.services.some(s => s.pid === children[0].child.pid))
  assert(updated.services.some(s => s.pid === children[1].child.pid))
  assert.notEqual(updated.collectedAt, inventory.collectedAt)
})

test('unavailable collector returns sanitized HTTP 503, not empty or stale inventory', { timeout: 20000 }, async t => {
  const port = await freePort()
  const server = startProcess(['scripts/start.mjs'], {
    env: { ...process.env, PORTSCOPE_PORT: String(port), PATH: '' }
  }, t)
  await waitForServer(server, port)
  const response = await fetch(`http://127.0.0.1:${port}/api/inventory`)
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.statusMessage, 'Inventory unavailable')
  assert(!('services' in body))
  assert(!JSON.stringify(body).includes('stack'))
  assert(!JSON.stringify(body).includes(root))
})
