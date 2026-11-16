import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedRequest } from '../server/utils/security.ts'
import { assertNotRoot, parsePort, serverEnvironment } from '../scripts/config.mjs'
import { checkPort } from '../scripts/start.mjs'
import { createServer } from 'node:net'

test('only loopback Host and exact same-origin requests are allowed', () => {
  for (const host of ['localhost', 'localhost:8080', '127.0.0.1:80', '[::1]:8080']) {
    assert(isAllowedRequest(host, undefined))
    assert(isAllowedRequest(host, new URL(`http://${host}`).origin))
  }
  for (const host of [undefined, 'evil.test', '127.0.0.1.evil.test', 'localhost.evil.test', 'localhost@evil.test', '0.0.0.0', '[::]', 'localhost:65536', 'localhost,evil.test']) {
    assert(!isAllowedRequest(host, undefined), String(host))
  }
  for (const origin of ['https://evil.test', 'http://evil.test', 'null', 'http://localhost:80', 'http://127.0.0.1:8081', 'https://127.0.0.1:8080']) {
    assert(!isAllowedRequest('127.0.0.1:8080', origin), origin)
  }
})

test('port configuration defaults to 3100 and rejects invalid or ambiguous inputs', () => {
  assert.equal(parsePort(), 3100)
  assert.equal(parsePort('3200'), 3200)
  for (const port of ['0', '65536', '-1', 'abc', '', '80.0', ' 80', '80;echo bad']) {
    assert.throws(() => parsePort(port))
  }
  assert.throws(() => assertNotRoot(0), /root/)
  assert.doesNotThrow(() => assertNotRoot(501))
})

test('runtime environment overrides unsafe host/port/socket inheritance', () => {
  const env = serverEnvironment({
    PORTSCOPE_PORT: '3100', HOST: '0.0.0.0', NITRO_HOST: '::', NUXT_PORT: '3000',
    NITRO_UNIX_SOCKET: '/tmp/not-a-real-socket'
  })
  assert.equal(env.NITRO_HOST, '127.0.0.1')
  assert.equal(env.HOST, '127.0.0.1')
  assert.equal(env.NUXT_HOST, '127.0.0.1')
  assert.equal(env.NITRO_PORT, '3100')
  assert.equal(env.PORT, '3100')
  assert.equal(env.NITRO_UNIX_SOCKET, '')
})

test('occupied port fails explicitly, with no silent fallback', async t => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await assert.rejects(checkPort(server.address().port), /already in use.*PORTSCOPE_PORT/)
})
