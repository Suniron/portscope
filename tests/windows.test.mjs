import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import test from 'node:test'
import { collectInventory } from '../server/utils/collector.ts'
import { groupListeners } from '../server/utils/parsers.ts'
import { parseWindowsListeners, WINDOWS_LISTENERS_SCRIPT } from '../server/utils/windows.ts'

const row = { pid: 42, processName: 'node', address: '127.0.0.1', port: 3000 }
const windowsOnly = { skip: process.platform !== 'win32', timeout: 30000 }
const exec = promisify(execFile)

test('Windows JSON accepts arrays, BOM, IPv4, IPv6 and inaccessible owner names', () => {
  assert.deepEqual(parseWindowsListeners('\uFEFF[]\r\n'), [])
  assert.deepEqual(parseWindowsListeners(JSON.stringify([row])), [{
    pid: 42, processName: 'node',
    endpoint: { address: '127.0.0.1', port: 3000, family: 'IPv4', url: null }
  }])
  const services = groupListeners(parseWindowsListeners(`\uFEFF${JSON.stringify([
    { ...row, processName: 'développeur' },
    { ...row, address: '::', port: 65535 },
    { ...row, pid: 0, processName: null, address: 'fe80::1%12', port: 1 }
  ])}`))
  assert.equal(services.length, 2)
  assert.equal(services[0].pid, 0)
  assert.equal(services[0].processName, null)
  assert.equal(services[0].endpoints[0].family, 'IPv6')
  assert.equal(services[1].processName, 'développeur')
  assert.equal(services[1].endpoints[1].family, 'IPv6')
  assert(services.every(service => service.cwd === null && service.project === null))
  assert(services.flatMap(service => service.endpoints).every(endpoint => endpoint.url === null))
})

test('Windows JSON rejects invalid payloads instead of reporting a healthy empty inventory', () => {
  for (const value of ['', 'not JSON', '{}', 'null', JSON.stringify(row), '[null]', '[[]]', '[42]']) {
    assert.throws(() => parseWindowsListeners(value), undefined, value)
  }
  for (const invalid of [
    { pid: null }, { pid: -1 }, { pid: 1.5 }, { pid: '42' }, { pid: Number.MAX_SAFE_INTEGER + 1 },
    { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: '3000' },
    { address: '*' }, { address: 'localhost' }, { address: '999.1.1.1' },
    { address: '127.0.0.1%12' }, { address: 'fe80::1%' }, { address: null },
    { processName: 42 }, { processName: {} }
  ]) {
    const value = JSON.stringify([{ ...row, ...invalid }])
    assert.throws(() => parseWindowsListeners(value), /Invalid Windows listener payload/, value)
  }
  for (const key of Object.keys(row)) {
    const incomplete = { ...row }
    delete incomplete[key]
    assert.throws(() => parseWindowsListeners(JSON.stringify([incomplete])))
  }
  assert.throws(() => parseWindowsListeners(JSON.stringify([row, { ...row, port: 0 }])))
})

test('Windows parser exposes only the approved inventory fields', () => {
  const [listener] = parseWindowsListeners(JSON.stringify([{ ...row, commandLine: 'private', environment: { secret: 'private' } }]))
  assert.deepEqual(Object.keys(listener).sort(), ['endpoint', 'pid', 'processName'])
  assert(!JSON.stringify(listener).includes('private'))
  assert.doesNotMatch(WINDOWS_LISTENERS_SCRIPT, /CommandLine|Environment|ExecutablePath|ReadProcessMemory|Win32_Process/i)
})

test('PowerShell script emits UTF-8 JSON arrays for zero/one/many listeners and tolerates inaccessible owners', windowsOnly, async () => {
  for (const connections of [
    '@()',
    '@([pscustomobject]@{ State = "Listen"; OwningProcess = 42; LocalAddress = "::1"; LocalPort = 3000 })',
    `@(
      [pscustomobject]@{ State = "Listen"; OwningProcess = 42; LocalAddress = "127.0.0.1"; LocalPort = 3000 },
      [pscustomobject]@{ State = "Listen"; OwningProcess = 99; LocalAddress = "fe80::1%12"; LocalPort = 3001 },
      [pscustomobject]@{ State = "Established"; OwningProcess = 42; LocalAddress = "127.0.0.1"; LocalPort = 3002 }
    )`
  ]) {
    const script = `
function Get-NetTCPConnection { ${connections} }
function Get-Process {
  param([int]$Id)
  if ($Id -eq 99) { throw 'Access denied' }
  [pscustomobject]@{ ProcessName = ('d' + [char]0xE9 + 'veloppeur') }
}
${WINDOWS_LISTENERS_SCRIPT}`
    const { stdout, stderr } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true
    })
    assert.equal(stderr.trim(), '')
    const listeners = parseWindowsListeners(stdout)
    assert.equal(listeners.length, connections === '@()' ? 0 : connections.includes('Established') ? 2 : 1)
    if (listeners.length) assert.equal(listeners[0].processName, 'développeur')
    if (listeners.length === 2) assert.equal(listeners[1].processName, null)
  }
  await assert.rejects(exec('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `function Get-NetTCPConnection { throw 'Collection denied' }\n${WINDOWS_LISTENERS_SCRIPT}`
  ], { timeout: 10000, windowsHide: true }))
})

test('Windows collection failure is actionable, not an empty inventory', windowsOnly, async () => {
  await assert.rejects(collectInventory(AbortSignal.abort()), /Local inventory is unavailable.*Windows PowerShell.*Get-NetTCPConnection/)
})

test('real Windows inventory observes this process TCP ports without project or protocol guesses', windowsOnly, async t => {
  const servers = []
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  })
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host, port: 0, ipv6Only: host === '::1' }, resolve)
    })
    servers.push(server)
  }
  const previousPort = process.env.PORTSCOPE_PORT
  t.after(() => {
    if (previousPort === undefined) delete process.env.PORTSCOPE_PORT
    else process.env.PORTSCOPE_PORT = previousPort
  })
  delete process.env.PORTSCOPE_PORT
  const inventory = await collectInventory()
  assert.equal(inventory.platform, 'win32')
  const own = inventory.services.find(service => service.pid === process.pid)
  assert(own, 'must report our PID')
  assert.equal(typeof own.processName, 'string')
  assert(own.processName.length > 0)
  for (const server of servers) {
    const { address, port, family } = server.address()
    const endpoint = own.endpoints.find(endpoint => endpoint.address === address && endpoint.port === port)
    assert(endpoint, `missing ${address}:${port}`)
    assert.equal(endpoint.family, family)
    assert.equal(endpoint.url, null, 'a TCP listener is not evidence of HTTP')
  }
  assert(inventory.services.every(service => service.cwd === null && service.project === null))
  assert(inventory.warnings.some(warning => /Windows.*working directories.*unknown/.test(warning)))
  assert(inventory.services.every(service => !('commandLine' in service) && !('env' in service)))
})
