import assert from 'node:assert/strict'
import test from 'node:test'
import { groupServices } from '../app/utils/service-groups.ts'

const service = (id, cwd, port) => ({
  id, cwd, pid: Number(id), processName: 'node', project: null,
  endpoints: [{ address: '127.0.0.1', port, family: 'IPv4', url: null }],
})

test('same exact cwd groups adjacent services without losing process/port associations, changing input or breaking sort order', () => {
  const adjacentServices = [
    service('1', '/work/app', 3000),
    service('3', '/work/app', 3050),
    service('2', '/work/other', 3100),
    service('4', '/work/app/subdirectory', 5000),
  ]
  const original = structuredClone(adjacentServices)
  const groups = groupServices(adjacentServices, '/home/dev')
  assert.deepEqual(groups.map(group => group.services.map(service => service.id)), [['1', '3'], ['2'], ['4']])
  assert.equal(groups[0].services[1], adjacentServices[1])
  assert.deepEqual(adjacentServices, original)

  // Non-adjacent services with the same cwd remain separate to preserve global sort order
  const nonAdjacent = [
    service('1', '/work/app', 3000),
    service('2', '/work/other', 3100),
    service('3', '/work/app', 4000),
  ]
  assert.deepEqual(groupServices(nonAdjacent, '/home/dev').map(group => group.services.map(service => service.id)), [['1'], ['2'], ['3']])
  assert.deepEqual(groupServices(adjacentServices.filter(service => service.id === '3'), '/home/dev')[0].services, [adjacentServices[1]])
  const colonPaths = [service('1', '/work/api:legacy', 3000), service('2', '/work/api', 4000)]
  assert.deepEqual(groupServices(colonPaths, '/home/dev').map(group => group.services.length), [1, 1])
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
