import assert from 'node:assert/strict'
import test from 'node:test'
import { groupListeners, parseEndpoint, parseLsof, parseLsofCwds, parseSs } from '../server/utils/parsers.ts'

test('macOS lsof: IPv4, IPv6, wildcard, spaces in process name, multiple listeners per PID', () => {
  const rows = parseLsof(`p101
cWeb Helper
n127.0.0.1:3000
n[::1]:3000
n*:8080
p202
cpostgres
n[fe80::1%lo0]:5432
`)
  const services = groupListeners(rows)
  assert.equal(services.length, 2)
  assert.equal(services[0].pid, 101)
  assert.equal(services[0].processName, 'Web Helper')
  assert.equal(services[0].endpoints.length, 3)
  assert.equal(services[0].endpoints[0].family, 'IPv6')
  assert.equal(services[1].endpoints[0].family, 'IPv6')
  assert.equal(services[1].endpoints[0].url, null)
})

test('Linux ss preserves unknown owners and groups shared process listeners', () => {
  const services = groupListeners(parseSs(`LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20))
LISTEN 0 128 [::1]:3001 [::]:* users:(("node",pid=42,fd=21))
LISTEN 0 4096 *:5432 *:*
LISTEN 0 128 [::]:8080 [::]:* users:(("worker",pid=90,fd=3),("worker",pid=91,fd=3))
`))
  assert.equal(services.length, 4)
  assert.equal(services.find(s => s.pid === 42).endpoints.length, 2)
  const unknown = services.find(s => s.pid === null)
  assert.equal(unknown.endpoints[0].port, 5432)
  assert.equal(unknown.processName, null)
  assert.equal(unknown.project, null)
  assert.equal(unknown.endpoints[0].url, null)
})

test('endpoint parsing supports unbracketed IPv6 and rejects invalid ports', () => {
  assert.equal(parseEndpoint(':::8080').address, '::')
  assert.equal(parseEndpoint(':::8080').family, 'IPv6')
  assert.equal(parseEndpoint('*:80').family, null)
  for (const value of ['127.0.0.1:0', '[::1]:65536', 'bad', '127.0.0.1:http']) {
    assert.equal(parseEndpoint(value), null)
  }
})

test('duplicate sockets are deduplicated without hiding distinct unknown endpoints', () => {
  const rows = parseLsof('p1\ncnode\nn127.0.0.1:4000\nn127.0.0.1:4000\n')
  assert.equal(groupListeners(rows)[0].endpoints.length, 1)
  const unknown = groupListeners(parseSs('LISTEN 0 128 *:80 *:*\nLISTEN 0 128 *:81 *:*\n'))
  assert.equal(unknown.length, 2)
})

test('batched macOS cwd records retain PID association and spaces', () => {
  const directories = parseLsofCwds('p12\nfcwd\nn/Users/Example Person/project\np34\nfcwd\nn/private/worktree\np56\nnpermission denied\n')
  assert.equal(directories.get(12), '/Users/Example Person/project')
  assert.equal(directories.get(34), '/private/worktree')
  assert.equal(directories.has(56), false)
})
