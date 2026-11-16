import assert from 'node:assert/strict'
import test from 'node:test'
import { httpAttemptUrl } from '../app/utils/browser-url.ts'

test('scoped IPv6 stays visible without an unusable browser URL', () => {
  assert.equal(httpAttemptUrl({ address: 'fe80::1%en0', port: 8000, family: 'IPv6' }), undefined)
  assert.equal(httpAttemptUrl({ address: 'fe80::1%25en0', port: 8000, family: 'IPv6' }), undefined)
})

test('HTTP attempts retain distinct IPv4, IPv6 and network listener addresses', () => {
  const ipv4 = httpAttemptUrl({ address: '127.0.0.1', port: 4000, family: 'IPv4' })
  const ipv6 = httpAttemptUrl({ address: '::1', port: 4000, family: 'IPv6' })
  assert.equal(ipv4, 'http://127.0.0.1:4000')
  assert.equal(ipv6, 'http://[::1]:4000')
  assert.notEqual(ipv4, ipv6)
  assert.equal(httpAttemptUrl({ address: '192.168.1.20', port: 8000, family: 'IPv4' }), 'http://192.168.1.20:8000')
  assert.equal(httpAttemptUrl({ address: '2001:db8::5', port: 8000, family: 'IPv6' }), 'http://[2001:db8::5]:8000')
})

test('wildcard listeners use loopback in the same address family', () => {
  for (const address of ['*', '0.0.0.0']) {
    assert.equal(httpAttemptUrl({ address, port: 4000, family: 'IPv4' }), 'http://127.0.0.1:4000')
  }
  for (const address of ['*', '::']) {
    assert.equal(httpAttemptUrl({ address, port: 4000, family: 'IPv6' }), 'http://[::1]:4000')
  }
})
