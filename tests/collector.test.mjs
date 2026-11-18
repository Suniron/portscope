import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectInventory, createInventoryCache, enrichServices, identifyOwnEndpoint, projectContext } from '../server/utils/collector.ts'

test('project context reads actual Git metadata, nested cwd and linked worktrees', async t => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'portscope-project-')))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'project with spaces')
  const linked = join(temp, 'linked & worktree')
  await mkdir(join(root, '.git', 'refs', 'heads'), { recursive: true })
  await mkdir(join(root, '.git', 'objects'))
  await mkdir(join(root, 'src'), { recursive: true })
  // Minimal on-disk Git fixtures: no init, commits or writes to a real checkout.
  await writeFile(join(root, '.git', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n')
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(root, 'package.json'), '{"name":"example-project"}')
  assert.deepEqual(await projectContext(join(root, 'src')), {
    root: root.replaceAll('\\', '/'), name: 'example-project', branch: 'main', branchUrl: null, worktree: null
  })
  await mkdir(join(root, '.git', 'worktrees', 'topic'), { recursive: true })
  await mkdir(linked)
  await writeFile(join(linked, '.git'), `gitdir: ${join(root, '.git/worktrees/topic')}\n`)
  await writeFile(join(root, '.git/worktrees/topic/HEAD'), 'ref: refs/heads/topic\n')
  await writeFile(join(root, '.git/worktrees/topic/commondir'), '../..\n')
  await writeFile(join(root, '.git/worktrees/topic/gitdir'), `${join(linked, '.git')}\n`)
  assert.deepEqual(await projectContext(linked), {
    root: linked.replaceAll('\\', '/'), name: 'linked & worktree', branch: 'topic', branchUrl: null,
    worktree: linked.replaceAll('\\', '/')
  })

  async function object(type, content) {
    const data = Buffer.from(`${type} ${Buffer.byteLength(content)}\0${content}`)
    const hash = createHash('sha1').update(data).digest('hex')
    await mkdir(join(root, '.git', 'objects', hash.slice(0, 2)), { recursive: true })
    await writeFile(join(root, '.git', 'objects', hash.slice(0, 2), hash.slice(2)), deflateSync(data))
    return hash
  }
  const tree = await object('tree', '')
  const commit = await object('commit', `tree ${tree}\nauthor Example <test@example.test> 0 +0000\ncommitter Example <test@example.test> 0 +0000\n\nFixture\n`)
  await writeFile(join(root, '.git/refs/heads/main'), `${commit}\n`)
  await mkdir(join(root, '.git/refs/remotes/origin/published'), { recursive: true })
  await writeFile(join(root, '.git/refs/remotes/origin/published/different'), `${commit}\n`)
  const config = `[core]
repositoryformatversion = 0
bare = false
[remote "origin"]
url = https://person:secret@github.com/team/project.git?token=secret
fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
remote = origin
merge = refs/heads/published/different
`
  await writeFile(join(root, '.git/config'), config)
  const tracked = await projectContext(root)
  assert.equal(tracked.branch, 'main')
  assert.equal(tracked.branchUrl, 'https://github.com/team/project/tree/published%2Fdifferent')
  assert(!JSON.stringify(tracked).includes('secret'))
  await rm(join(root, '.git/refs/remotes/origin/published/different'))
  assert.equal((await projectContext(root)).branchUrl, null, 'gone upstream must not look published')
  await writeFile(join(root, '.git/config'), config.replace('merge = refs/heads/published/different', ''))
  assert.equal((await projectContext(root)).branchUrl, null, 'remote alone is not publication evidence')
})

test('non-Git project manifests are read as data, missing metadata stays unknown', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-manifest-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  assert.equal(await projectContext(temp), null)
  await writeFile(join(temp, 'package.json'), '{"name":"plain-project","scripts":{"dev":"DO NOT EXECUTE"}}')
  assert.deepEqual(await projectContext(temp), { root: temp, name: 'plain-project', branch: null, branchUrl: null, worktree: null })
  await writeFile(join(temp, 'package.json'), '{malformed')
  assert.equal(await projectContext(temp), null)
})

test('HTTP links require known server identity, not a familiar port', () => {
  const service = {
    pid: 10,
    endpoints: [
      { address: '127.0.0.1', port: 3000, family: 'IPv4', url: null },
      { address: '::1', port: 8080, family: 'IPv6', url: null },
      { address: '*', port: 5432, family: null, url: null }
    ]
  }
  identifyOwnEndpoint(service, 99, 3000)
  assert(service.endpoints.every(e => e.url === null))
  identifyOwnEndpoint(service, 10, 3000)
  assert.equal(service.endpoints[0].url, 'http://127.0.0.1:3000')
  assert.equal(service.endpoints[1].url, null, 'same-process IPC ports are not HTTP evidence')
  assert.equal(service.endpoints[2].url, null)
  identifyOwnEndpoint(service, 10, 8080)
  assert.equal(service.endpoints[1].url, 'http://[::1]:8080')
})

test('cache coalesces concurrent requests and expires after completion', async () => {
  let calls = 0
  let finish
  const cache = createInventoryCache(() => {
    calls++
    return new Promise(resolve => { finish = resolve })
  }, 0)
  const first = cache()
  assert.equal(cache(), first)
  assert.equal(calls, 1)
  finish({ services: [] })
  await first
  const next = cache()
  assert.notEqual(next, first)
  assert.equal(calls, 2)
  finish({ services: [] })
  await next
})

test('cache retains a failure briefly, never disguises it as healthy empty or stale data', async () => {
  let calls = 0
  const cache = createInventoryCache(async () => { calls++; throw new Error('unavailable') }, 5000)
  await assert.rejects(cache(), /unavailable/)
  await assert.rejects(cache(), /unavailable/)
  assert.equal(calls, 1)
})

test('cache invalidation also discards in-flight results without expiring a newer request', async () => {
  const releases = []
  const cache = createInventoryCache(() => new Promise(resolve => releases.push(resolve)))
  const old = cache()
  cache.invalidate()
  const fresh = cache()
  assert.notEqual(old, fresh)
  releases[0]({ services: ['old'] })
  await old
  assert.equal(cache(), fresh)
  releases[1]({ services: ['new'] })
  await fresh
  assert.equal(cache(), fresh)
  cache.invalidate()
  const next = cache()
  releases[2]({ services: ['next'] })
  assert.deepEqual(await next, { services: ['next'] })
})

test('a real FIFO manifest cannot block project discovery', { skip: process.platform === 'win32', timeout: 8000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-fifo-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const exec = promisify(execFile)
  await exec('mkfifo', [join(temp, 'package.json')])
  const module = new URL('../server/utils/collector.ts', import.meta.url).href
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
    import { projectContext } from ${JSON.stringify(module)};
    console.log(JSON.stringify(await projectContext(${JSON.stringify(temp)})));
  `], { timeout: 5000, killSignal: 'SIGKILL' })
  assert.equal(stdout.trim(), 'null')
})

test('cache recovers after a collection that never settles', async () => {
  let calls = 0
  let signal
  const cache = createInventoryCache(abort => {
    signal = abort
    return ++calls === 1 ? new Promise(() => {}) : Promise.resolve({ services: [] })
  }, 0, 20)
  await assert.rejects(Promise.race([
    cache(),
    delay(150).then(() => { throw new Error('cache failed to enforce its deadline') })
  ]), /unavailable/)
  assert(signal.aborted)
  assert.deepEqual(await cache(), { services: [] })
  assert.equal(calls, 2)
})

test('cache bounds abandoned collectors and ignores late results', async () => {
  const releases = []
  const cache = createInventoryCache(() => new Promise(resolve => releases.push(resolve)), 0, 10)
  for (let attempt = 0; attempt < 20; attempt++) await assert.rejects(cache(), /unavailable/)
  assert.equal(releases.length, 2, 'stuck collectors must not accumulate on refresh')
  releases[0]({ services: ['expired'] })
  await delay(0)
  const fresh = cache()
  assert.equal(releases.length, 3, 'a genuinely completed collector frees its slot')
  releases[2]({ services: ['fresh'] })
  assert.deepEqual(await fresh, { services: ['fresh'] })
  releases[1]({ services: ['also expired'] })
})

test('metadata deadline preserves endpoints and caps uncancellable work across refreshes', async t => {
  const services = Array.from({ length: 5 }, (_, i) => ({
    id: `pid:${i + 1}`, pid: i + 1, processName: 'example', cwd: null, project: null,
    endpoints: [{ address: '127.0.0.1', port: 4000 + i, family: 'IPv4', url: null }]
  }))
  const original = structuredClone(services)
  const releases = []
  const signals = []
  const inspect = (service, signal) => {
    signals.push(signal)
    return new Promise(resolve => releases.push(() => resolve({ cwd: '/expired', project: null })))
  }
  t.after(() => { for (const release of releases) release() })
  const started = performance.now()
  assert.equal(await enrichServices(services, inspect, undefined, 20), false)
  assert(performance.now() - started < 500, 'deadline must apply to running tasks, not only between tasks')
  assert(signals.every(signal => signal.aborted))
  assert.deepEqual(services, original, 'timed-out metadata must not hide listeners')
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal(await enrichServices(services, inspect, undefined, 20), false)
  }
  assert.equal(releases.length, 2, 'uncancellable FS operations retain bounded slots')
  for (const release of releases) release()
  await delay(0)
  assert.deepEqual(services, original, 'late metadata must not mutate the returned inventory')
  assert.equal(await enrichServices(services, async () => ({ cwd: '/fresh', project: null })), true)
  assert(services.every(service => service.cwd === '/fresh'))
})

test('oversized and non-regular manifests are not read as project metadata', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-manifest-kind-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  await mkdir(join(temp, 'package.json'))
  assert.equal(await projectContext(temp), null)
  await rm(join(temp, 'package.json'), { recursive: true })
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'x'.repeat(256 * 1024) }))
  assert.equal(await projectContext(temp), null)
})

test('real platform collection returns safe inventory fields', {
  skip: !['darwin', 'linux', 'win32'].includes(process.platform), timeout: 20000
}, async () => {
  const inventory = await collectInventory()
  assert.equal(inventory.platform, process.platform)
  assert(!Number.isNaN(Date.parse(inventory.collectedAt)))
  assert.equal(inventory.homeDirectory, await realpath(homedir()).catch(() => homedir()))
  assert(Array.isArray(inventory.warnings))
  for (const service of inventory.services) {
    assert.deepEqual(Object.keys(service).filter(key => key !== 'stopSupervisor').sort(), ['cwd', 'endpoints', 'id', 'metrics', 'pid', 'processName', 'processStartId', 'project', 'startedAt', 'stopDisabledReason'])
    if (service.stopSupervisor) {
      assert.deepEqual(Object.keys(service.stopSupervisor).sort(), ['pid', 'processStartId'])
      assert(Number.isSafeInteger(service.stopSupervisor.pid) && service.stopSupervisor.pid > 1)
      assert.equal(typeof service.stopSupervisor.processStartId, 'string')
    }
    assert(service.endpoints.length > 0)
    assert(!('commandLine' in service))
    assert(!('env' in service))
  }
})
