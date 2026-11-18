import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openProcess, parseOpenRequest } from '../server/utils/processes.ts'

const target = { pid: 42, processStartId: 'start', destination: 'folder' }
const inspect = async () => new Map([[42, { pid: 42, processStartId: 'start' }]])

test('opening validates identity and destination, never accepts a client path', () => {
  assert.deepEqual(parseOpenRequest(target), target)
  assert.deepEqual(parseOpenRequest({ ...target, path: '/untrusted' }), target)
  for (const value of [null, [], {}, { ...target, pid: 1 }, { ...target, processStartId: '' }, { ...target, destination: 'shell' }]) {
    assert.throws(() => parseOpenRequest(value), /Invalid/)
  }
})

test('opening uses known worktree/root/cwd and argument arrays, never a shell or client-supplied command', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-open-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const worktree = join(temp, 'worktree ; $(not-executed)')
  await mkdir(worktree)
  const resolved = await realpath(worktree)
  const service = { ...target, project: { worktree, root: temp }, cwd: temp }
  for (const [platform, destination, file, args] of [
    ['darwin', 'folder', '/usr/bin/open', [resolved]],
    ['darwin', 'editor', '/usr/bin/open', ['-a', 'Visual Studio Code', resolved]],
    ['linux', 'folder', 'xdg-open', [resolved]],
    ['linux', 'editor', 'code', ['--', resolved]],
    ['win32', 'folder', 'explorer.exe', [resolved]]
  ]) {
    const calls = []
    assert.deepEqual(await openProcess({ ...target, destination }, [service], {
      platform, inspect, execute: async (...args) => { calls.push(args) }
    }), { opened: true })
    assert.deepEqual(calls, [[file, args]])
  }
  for (const project of [{ worktree: 'branch-name', root: worktree }, null]) {
    const calls = []
    await openProcess(target, [{ ...service, project, cwd: worktree }], { platform: 'darwin', inspect, execute: async (...args) => { calls.push(args) } })
    assert.deepEqual(calls, [['/usr/bin/open', [resolved]]])
  }
  const windowsCalls = []
  await openProcess({ ...target, destination: 'editor' }, [service], {
    platform: 'win32', inspect, execute: async (...args) => { windowsCalls.push(args) }
  })
  assert.match(windowsCalls[0][0], /(?:^|[/\\])Code\.exe$/i)
  assert.deepEqual(windowsCalls[0][1], ['--', resolved])
})

test('stale identities, unknown/inaccessible paths and launch failures return explicit errors without opening anything', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-open-errors-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const file = join(temp, 'not-a-directory')
  await writeFile(file, 'fixture')
  const service = { ...target, project: null, cwd: temp }
  let calls = 0
  const execute = async () => { calls++ }
  for (const [observed, check, status] of [
    [[], inspect, 409],
    [[service], async () => new Map(), 409],
    [[service], async () => new Map([[42, { processStartId: 'reused' }]]), 409],
    [[service], async () => { throw new Error('private'); }, 503],
    [[{ ...service, cwd: null }], inspect, 404],
    [[{ ...service, cwd: join(temp, 'missing') }], inspect, 404],
    [[{ ...service, cwd: file }], inspect, 404]
  ]) {
    await assert.rejects(openProcess(target, observed, { platform: 'darwin', inspect: check, execute }), error => error.statusCode === status)
  }
  assert.equal(calls, 0)
  await assert.rejects(openProcess({ ...target, destination: 'editor' }, [service], {
    platform: 'darwin', inspect, execute: async () => { throw new Error('private') }
  }), error => error.statusCode === 503 && /Visual Studio Code/.test(error.message) && !error.message.includes('private'))
})
