import assert from 'node:assert/strict'
import test from 'node:test'
import { groupServices } from '../app/utils/service-groups.ts'

const service = (id, cwd, port) => ({
  id, cwd, pid: Number(id), processName: 'node', project: null,
  endpoints: [{ address: '127.0.0.1', port, family: 'IPv4', url: null }],
})

test('same exact cwd groups services without losing process/port associations or changing input', () => {
  const services = [
    service('1', '/work/app', 3000),
    service('2', '/work/other', 3100),
    service('3', '/work/app', 4000),
    service('4', '/work/app/subdirectory', 5000),
  ]
  const original = structuredClone(services)
  const groups = groupServices(services, '/home/dev')
  assert.deepEqual(groups.map(group => group.services.map(service => service.id)), [['1', '3'], ['2'], ['4']])
  assert.equal(groups[0].services[1], services[2])
  assert.deepEqual(services, original)
  assert.deepEqual(groupServices(services.filter(service => service.id === '3'), '/home/dev')[0].services, [services[2]])
})

test('root, actual home directory, and unknown cwd remain separate; home subdirectories group', () => {
  for (const home of ['/Users/dev', '/home/dev', '/srv/custom-home']) {
    const services = [home, home, '/', '/', null, null, `${home}/project`, `${home}/project`]
      .map((cwd, index) => service(String(index), cwd, 3000 + index))
    assert.deepEqual(groupServices(services, home).map(group => group.services.length), [1, 1, 1, 1, 1, 1, 2])
    assert.equal(groupServices(services, undefined).length, services.length)
  }
  assert.deepEqual(groupServices([], '/home/dev'), [])
})
