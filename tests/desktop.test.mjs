import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { externalUrl, navigationRules, startDesktopServer } from '../desktop/runtime.ts'

test('desktop binds its own ephemeral loopback socket without taking another listener', async t => {
  const existing = createServer()
  existing.listen(0, '127.0.0.1')
  await once(existing, 'listening')
  t.after(() => existing.close())
  const originalPort = process.env.PORTSCOPE_PORT
  const originalPath = process.env.PATH
  t.after(() => {
    if (originalPort === undefined) delete process.env.PORTSCOPE_PORT
    else process.env.PORTSCOPE_PORT = originalPort
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
  })
  process.env.PATH = ''
  const entrypoint = new URL('data:text/javascript,export const listener = (req, res) => res.end("ready")')
  const { server, origin } = await startDesktopServer(entrypoint)
  t.after(() => { server.close(); server.closeAllConnections() })
  assert.equal(server.address().address, '127.0.0.1')
  assert.notEqual(server.address().port, existing.address().port)
  assert.equal(process.env.PORTSCOPE_PORT, String(server.address().port))
  if (process.platform === 'win32') {
    assert(process.env.PATH.split(delimiter).includes(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0')))
  } else {
    assert.equal(process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin')
  }
  assert.equal(await fetch(origin).then(r => r.text()), 'ready')
  assert(existing.listening)
  const closed = once(server, 'close')
  server.close()
  server.closeAllConnections()
  await closed
  await assert.rejects(fetch(origin))
  assert(existing.listening)
})

test('desktop reports missing or invalid listeners before opening a socket', async () => {
  await assert.rejects(startDesktopServer(new URL('file:///nonexistent-portscope/server/index.mjs')))
  await assert.rejects(startDesktopServer(new URL('data:text/javascript,export const listener = null')), /listener is missing/)
})

test('navigation allows only the exact local HTTP origin with SDK ordered glob rules', () => {
  assert.deepEqual(JSON.parse(navigationRules('http://127.0.0.1:49152')), ['^*', 'http://127.0.0.1:49152/*'])
  for (const origin of [
    'http://localhost:49152', 'http://127.0.0.1', 'https://127.0.0.1:49152',
    'http://127.0.0.1:49152/', 'http://127.0.0.1:49152/path', 'http://127.0.0.1.evil:49152',
    'http://user@127.0.0.1:49152', 'file:///etc/passwd'
  ]) assert.throws(() => navigationRules(origin), undefined, origin)
})

test('new-window event payloads only open absolute HTTP(S) URLs externally', () => {
  assert.equal(externalUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000/')
  assert.equal(externalUrl({ url: 'https://github.com/team/project', isCmdClick: true }), 'https://github.com/team/project')
  for (const value of [
    'javascript:alert(1)', 'file:///etc/passwd', 'views://internal', 'data:text/html,hi',
    'mailto:test@example.com', '/relative', '//example.com', {}, null, { url: 123 }
  ]) assert.equal(externalUrl(value), null)
})
