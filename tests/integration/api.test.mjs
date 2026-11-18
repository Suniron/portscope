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

async function freePort(preferred = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(preferred, '127.0.0.1', resolve)
  })
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

test('production API: live external listeners, unknown TCP, cache, security, bind failures', { timeout: 75000 }, async t => {
  await access(join(root, '.output/server/index.mjs'))
  const temp = await mkdtemp(join(tmpdir(), 'portscope-live-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const children = []
  for (const name of ['first-project', 'second-project']) {
    const cwd = join(temp, name)
    await mkdir(cwd)
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name }))
    // Keep fixture metadata early in the collector's bounded, port-sorted queue on busy developer machines.
    let fixturePort
    for (let candidate = 10240; candidate < 10340; candidate++) {
      try { fixturePort = await freePort(candidate); break } catch {}
    }
    assert(fixturePort, 'a low unprivileged fixture port must be available')
    const server = startProcess(['-e', `
      const net = require('node:net');
      ${name === 'second-project' ? "process.on('SIGTERM', () => {});" : ''}
      const server = net.createServer(socket => socket.end('not HTTP'));
      server.listen(${fixturePort}, '127.0.0.1', () => console.log(server.address().port));
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
  let inventory
  const metadataDeadline = Date.now() + 30000
  // Partial metadata is a valid bounded response; wait for these fixtures, not unrelated machine processes.
  do {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('access-control-allow-origin'), null)
    inventory = await response.json()
    if (children.every(external => inventory.services.some(service =>
      service.pid === external.child.pid && service.cwd && service.project?.name === external.name
      && typeof service.processStartId === 'string' && service.stopDisabledReason === null
    ))) break
    await delay(1000)
  } while (Date.now() < metadataDeadline)
  for (const external of children) {
    const observed = inventory.services.find(s => s.pid === external.child.pid)
    assert(observed, 'external service remains visible')
    assert.equal(observed.project?.name, external.name, JSON.stringify({ observed, warnings: inventory.warnings }))
    assert(observed.endpoints.every(e => e.url === null), 'arbitrary TCP must not be advertised as HTTP')
    assert.equal(typeof observed.processStartId, 'string')
    assert(Number.isFinite(Date.parse(observed.startedAt)))
    assert(observed.metrics.rssBytes >= 0)
  }
  const own = inventory.services.find(s => s.pid === server.child.pid)
  assert(own)
  assert(own.endpoints.every(e => e.address === '127.0.0.1'), 'launcher must override unsafe binding environment')
  assert(own.endpoints.some(e => e.url === `http://127.0.0.1:${port}`))
  assert.equal(own.stopDisabledReason, 'protected')
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
  const stopUrl = `http://127.0.0.1:${port}/api/processes/stop`
  const actionHeaders = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'X-Portscope-Action': 'stop' }
  const targets = children.map(external => {
    const observed = inventory.services.find(s => s.pid === external.child.pid)
    return { pid: observed.pid, processStartId: observed.processStartId }
  })
  const body = JSON.stringify({ targets: [targets[0]], force: false })
  for (const headers of [
    { 'Content-Type': 'application/json', 'X-Portscope-Action': 'stop' },
    { ...actionHeaders, Origin: 'http://evil.example' },
    { ...actionHeaders, Origin: 'null' },
    { ...actionHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    { Origin: actionHeaders.Origin, 'Content-Type': 'application/json' },
    { ...actionHeaders, Host: 'hostile.example' }
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(stopUrl, { method: 'POST', headers }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject)
      req.end(body)
    })
    assert.equal(status, 403, JSON.stringify(headers))
    assert.equal(children[0].child.exitCode, null)
    assert.equal(children[0].child.signalCode, null, 'rejected CSRF request must not signal')
  }
  for (const invalid of [
    { targets: [targets[0], targets[0]], force: false },
    { targets: [{ ...targets[0], pid: 1 }], force: true },
    { targets: [targets[0]], force: 'true' }
  ]) assert.equal((await fetch(stopUrl, { method: 'POST', headers: actionHeaders, body: JSON.stringify(invalid) })).status, 400)
  assert.equal(children[0].child.signalCode, null)
  const stale = await fetch(stopUrl, {
    method: 'POST', headers: actionHeaders, body: JSON.stringify({ targets: [{ ...targets[0], processStartId: 'stale' }], force: false })
  }).then(response => response.json())
  assert.equal(stale.results[0].status, 'identity-changed')
  assert.equal(children[0].child.signalCode, null)
  const openUrl = `http://127.0.0.1:${port}/api/processes/open`
  assert.equal((await fetch(openUrl, {
    method: 'POST', headers: { ...actionHeaders, 'X-Portscope-Action': 'open' },
    body: JSON.stringify({ ...targets[0], processStartId: 'stale', destination: 'folder' })
  })).status, 409, 'stale opening must not launch an application')
  assert.equal((await fetch(openUrl, {
    method: 'POST', headers: actionHeaders, body: JSON.stringify({ ...targets[0], destination: 'folder' })
  })).status, 403, 'stop header cannot authorize opening')

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
  const stopped = await fetch(stopUrl, {
    method: 'POST', headers: actionHeaders,
    body: JSON.stringify({ targets: [{ pid: own.pid, processStartId: own.processStartId }, targets[0]], force: false })
  })
  assert.equal(stopped.status, 200)
  assert.deepEqual((await stopped.json()).results.map(row => row.status), ['protected', 'signal-sent'])
  await exited
  const updateResponse = await fetch(url)
  const updated = await updateResponse.json()
  assert.equal(updateResponse.status, 200, JSON.stringify(updated))
  assert(!updated.services.some(s => s.pid === children[0].child.pid))
  assert(updated.services.some(s => s.pid === children[1].child.pid))
  assert.notEqual(updated.collectedAt, inventory.collectedAt)
  const normal = await fetch(stopUrl, {
    method: 'POST', headers: actionHeaders, body: JSON.stringify({ targets: [targets[1]], force: false })
  }).then(response => response.json())
  assert.equal(normal.results[0].status, 'signal-sent')
  await delay(100)
  assert.equal(children[1].child.exitCode, null, 'normal stop must not automatically escalate')
  assert.equal(children[1].child.signalCode, null, 'fixture deliberately ignores TERM')
  const forcedExit = once(children[1].child, 'exit')
  const forced = await fetch(stopUrl, {
    method: 'POST', headers: actionHeaders, body: JSON.stringify({ targets: [targets[1]], force: true })
  }).then(response => response.json())
  assert.equal(forced.results[0].status, 'signal-sent')
  await forcedExit
  assert.equal(children[1].child.signalCode, 'SIGKILL')
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

test('production API can stop a dedicated Node parent and its listener', {
  timeout: 30000, skip: !['darwin', 'linux'].includes(process.platform) || process.getuid?.() === 0
}, async t => {
  const parent = startProcess(['-e', `
    const child = require('node:child_process').spawn(process.execPath, ['-e', \`
      require('node:net').createServer().listen(0, '127.0.0.1', () => console.log(process.pid));
      setTimeout(() => process.exit(), 25000).unref();
    \`], { stdio: 'inherit' });
    process.on('SIGTERM', () => { child.kill(); process.exit() });
    child.on('exit', () => setTimeout(() => process.exit(), 25000));
  `], {}, t)
  const [output] = await once(parent.child.stdout, 'data')
  const pid = Number(String(output).trim())
  assert(Number.isSafeInteger(pid) && pid > 1)
  const port = await freePort()
  const server = startProcess(['scripts/start.mjs'], { env: { ...process.env, PORTSCOPE_PORT: String(port) } }, t)
  await waitForServer(server, port)
  const origin = `http://127.0.0.1:${port}`
  const inventory = await fetch(`${origin}/api/inventory`).then(response => response.json())
  const listener = inventory.services.find(service => service.pid === pid)
  assert.equal(listener?.stopSupervisor?.pid, parent.child.pid)
  const target = { pid, processStartId: listener.processStartId, supervisor: listener.stopSupervisor }
  const stop = targets => fetch(`${origin}/api/processes/stop`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Portscope-Action': 'stop' },
    body: JSON.stringify({ targets, force: true })
  }).then(response => response.json())
  const stale = { ...target, supervisor: { ...target.supervisor, processStartId: 'stale' } }
  assert.equal((await stop([stale])).results[0].status, 'identity-changed')
  assert.equal(parent.child.signalCode, null)
  process.kill(pid, 0)

  const exited = once(parent.child, 'exit')
  assert.equal((await stop([target])).results[0].status, 'signal-sent')
  assert.deepEqual(await exited, [null, 'SIGKILL'])
  const updated = await fetch(`${origin}/api/inventory`).then(response => response.json())
  assert(!updated.services.some(service => service.pid === pid))
})
