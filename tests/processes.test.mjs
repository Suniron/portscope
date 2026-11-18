import assert from 'node:assert/strict'
import test from 'node:test'
import { createMetricsSampler, parsePs, parseStopRequest, parseWindowsProcesses, protectedPids, stopProcesses } from '../server/utils/processes.ts'

const info = (pid, ppid, processStartId = 'start', cpuSeconds = 1) => ({ pid, ppid, processStartId, startedAt: null, cpuSeconds, rssBytes: 2048 })
const target = pid => ({ pid, processStartId: 'start' })
const ancestry = () => new Map([
  [process.pid, info(process.pid, process.ppid)],
  [process.ppid, info(process.ppid, 1)],
  [1, info(1, 0)]
])
const childPid = Math.max(process.pid, process.ppid) + 100

test('stop request rejects invalid targets, duplicates, unsafe IDs and unbounded identities', () => {
  assert.deepEqual(parseStopRequest({ targets: [target(42)], force: false }), { targets: [target(42)], force: false })
  for (const body of [
    null, [], {}, { targets: [], force: false }, { targets: [target(42)] },
    { targets: [target(42)], force: 'true' }, { targets: [target(42), target(42)], force: false },
    ...[0, 1, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1].map(pid => ({ targets: [target(pid)], force: false })),
    ...['', ' ', 'x'.repeat(129), 'bad\nidentity', null, 42].map(processStartId => ({ targets: [{ pid: 42, processStartId }], force: false })),
    ...[null, target(1), target(42), { pid: 43, processStartId: '' }].map(supervisor => ({
      targets: [{ ...target(42), supervisor }], force: true
    })),
    { targets: Array.from({ length: 101 }, (_, i) => target(i + 2)), force: true }
  ]) assert.throws(() => parseStopRequest(body), /Invalid/)
})

test('ps parses cumulative CPU, RSS bytes and start identity without collecting commands', () => {
  const rows = parsePs(`
   42 12 12 501 1234 1:02.34 Tue Nov 17 12:03:04 2026 /path with spaces/node
   43 12 12 501 0 2-03:04:05 Mon Nov  9 00:00:00 2026 node
   44 12 12 501 - - - other process
 bad row
`)
  assert.deepEqual(rows.get(42), { pid: 42, ppid: 12, pgid: 12, uid: 501, executable: 'node', rssBytes: 1234 * 1024, cpuSeconds: 62.34, processStartId: 'Tue Nov 17 12:03:04 2026', startedAt: new Date('Tue Nov 17 12:03:04 2026').toISOString() })
  assert.equal(rows.get(43).cpuSeconds, 2 * 86400 + 3 * 3600 + 4 * 60 + 5)
  assert.equal(rows.get(43).processStartId, 'Mon Nov 9 00:00:00 2026')
  assert.deepEqual(rows.get(44), { pid: 44, ppid: 12, pgid: 12, uid: 501, executable: 'other process', rssBytes: null, cpuSeconds: null, processStartId: null, startedAt: null })
})

test('CPU sampling uses monotonic deltas, allows multiple cores, resets identities and prunes vanished PIDs', () => {
  const sample = createMetricsSampler()
  const rows = (start, cpu) => new Map([[42, info(42, 1, start, cpu)]])
  assert.deepEqual(sample(rows('a', 1), 1000).get(42), { rssBytes: 2048, cpuPercent: null })
  assert.equal(sample(rows('a', 4), 2000).get(42).cpuPercent, 300)
  assert.equal(sample(rows('a', 2), 3000).get(42).cpuPercent, null, 'counter reset')
  assert.equal(sample(rows('b', 3), 4000).get(42).cpuPercent, null, 'PID reuse')
  assert.equal(sample(rows('b', 3), 4000).get(42).cpuPercent, null, 'same timestamp')
  sample(new Map(), 5000)
  assert.equal(sample(rows('b', 4), 6000).get(42).cpuPercent, null, 'removed samples must not linger')
  assert.equal(sample(rows(null, null), 7000).get(42).cpuPercent, null)
})

test('Windows process metadata keeps exact tick strings and degrades unreadable fields to unknown', () => {
  const rows = parseWindowsProcesses(JSON.stringify([
    { pid: 42, ppid: 12, processStartId: '639305425840000000', rssBytes: 3000, cpuSeconds: 1.25, commandLine: 'private' },
    { pid: 43, ppid: 12, processStartId: null, rssBytes: -1, cpuSeconds: 'unknown' }
  ]))
  assert.equal(rows.get(42).processStartId, '639305425840000000')
  assert.equal(rows.get(42).cpuSeconds, 1.25)
  assert.equal(rows.get(43).rssBytes, null)
  assert.equal(rows.get(43).cpuSeconds, null)
  assert(!JSON.stringify([...rows.values()]).includes('private'))
  assert.throws(() => parseWindowsProcesses('[{"pid":42,"ppid":"bad"}]'))
})

test('self, parent, all ancestors and PID 0/1 are protected; incomplete or cyclic ancestry fails closed', () => {
  const rows = new Map([[100, info(100, 50)], [50, info(50, 12)], [12, info(12, 1)]])
  assert.deepEqual([...protectedPids(rows, 100, 50)].sort((a, b) => a - b), [0, 1, 12, 50, 100])
  rows.delete(12)
  assert.equal(protectedPids(rows, 100, 50), null)
  rows.set(12, info(12, 50))
  assert.equal(protectedPids(rows, 100, 50), null)
  assert.equal(protectedPids(rows, 100, 99), null)
})

function dependencies(rows, options = {}) {
  const signals = []
  let invalidations = 0
  return {
    signals,
    invalidations: () => invalidations,
    deps: {
      fresh: async () => ({ processes: rows, services: [target(childPid)] }),
      inspect: async () => rows,
      signal: (...args) => signals.push(args),
      invalidate: () => invalidations++,
      platform: 'darwin',
      ...options
    }
  }
}

test('identity is reread immediately before signalling and changed identities never receive a signal', async () => {
  const rows = ancestry()
  rows.set(childPid, info(childPid, 1))
  const changed = new Map(rows)
  changed.set(childPid, info(childPid, 1, 'reused'))
  const state = dependencies(rows, { inspect: async () => changed })
  const result = await stopProcesses({ targets: [target(childPid)], force: false }, [target(childPid)], state.deps)
  assert.equal(result.results[0].status, 'identity-changed')
  assert.deepEqual(state.signals, [])
  assert.equal(state.invalidations(), 0)
})

test('normal/force send only TERM/KILL to individual observed listeners and invalidate after attempts', async () => {
  for (const force of [false, true]) {
    const rows = ancestry()
    rows.set(childPid, info(childPid, 1))
    const state = dependencies(rows)
    assert.equal((await stopProcesses({ targets: [target(childPid)], force }, [target(childPid)], state.deps)).results[0].status, 'signal-sent')
    assert.deepEqual(state.signals, [[childPid, force ? 'SIGKILL' : 'SIGTERM']])
    assert.equal(state.invalidations(), 1)
  }
})

test('an opted-in Node supervisor is stopped before its listener, with the requested signal', async () => {
  const supervisor = target(childPid + 1)
  const processFields = { uid: process.getuid?.() ?? 501, pgid: childPid + 2, executable: 'node' }
  const rows = ancestry()
  rows.set(supervisor.pid, { ...info(supervisor.pid, 1), ...processFields })
  rows.set(childPid, { ...info(childPid, supervisor.pid), ...processFields })
  const service = { ...target(childPid), stopSupervisor: supervisor }
  const fresh = async () => ({ processes: rows, services: [service] })
  for (const force of [false, true]) {
    const state = dependencies(rows, { fresh })
    const request = parseStopRequest({ targets: [{ ...target(childPid), supervisor }], force })
    const result = await stopProcesses(request, [service], state.deps)
    const signal = force ? 'SIGKILL' : 'SIGTERM'
    assert.equal(result.results[0].status, 'signal-sent')
    assert.deepEqual(state.signals, [[supervisor.pid, signal], [childPid, signal]])
    assert.equal(state.invalidations(), 1)
  }
  for (const vanished of [supervisor.pid, childPid]) {
    const attempts = []
    const state = dependencies(rows, { fresh, signal(pid) {
      attempts.push(pid)
      if (pid === vanished) throw Object.assign(new Error(), { code: 'ESRCH' })
    } })
    const result = await stopProcesses({ targets: [{ ...target(childPid), supervisor }], force: false }, [service], state.deps)
    assert.equal(result.results[0].status, vanished === supervisor.pid ? 'identity-changed' : 'signal-sent')
    assert.deepEqual(attempts, vanished === supervisor.pid ? [supervisor.pid] : [supervisor.pid, childPid])
  }
})

test('an opted-in supervisor must be observed and still exclusively supervise the same listener', async () => {
  const supervisor = target(childPid + 1)
  const processFields = { uid: process.getuid?.() ?? 501, pgid: childPid + 2, executable: 'node' }
  const rows = ancestry()
  rows.set(supervisor.pid, { ...info(supervisor.pid, 1), ...processFields })
  rows.set(childPid, { ...info(childPid, supervisor.pid), ...processFields })
  const service = { ...target(childPid), stopSupervisor: supervisor }
  const fresh = async () => ({ processes: rows, services: [service] })
  for (const [observed, current] of [
    [target(childPid), rows],
    [service, new Map(rows).set(supervisor.pid, { ...rows.get(supervisor.pid), processStartId: 'reused' })],
    [service, new Map(rows).set(childPid + 3, info(childPid + 3, supervisor.pid))],
    [service, new Map(rows).set(supervisor.pid, { ...rows.get(supervisor.pid), executable: 'zsh' })],
    [service, new Map(rows).set(supervisor.pid, { ...rows.get(supervisor.pid), pgid: childPid + 4 })],
    [service, new Map(rows).set(supervisor.pid, { ...rows.get(supervisor.pid), uid: processFields.uid + 1 })]
  ]) {
    const state = dependencies(rows, { fresh, inspect: async () => current })
    const request = parseStopRequest({ targets: [{ ...target(childPid), supervisor }], force: true })
    const result = await stopProcesses(request, [observed], state.deps)
    assert.equal(result.results[0].status, 'identity-changed')
    assert.deepEqual(state.signals, [])
  }
})

test('batch reports protected, unobserved, missing listener and successful targets independently', async () => {
  const rows = ancestry()
  rows.set(childPid, info(childPid, 1))
  rows.set(childPid + 1, info(childPid + 1, 1))
  const state = dependencies(rows)
  const targets = [target(process.pid), target(process.ppid), target(childPid + 2), target(childPid + 1), target(childPid)]
  const result = await stopProcesses({ targets, force: false }, targets.filter(t => t.pid !== childPid + 2), state.deps)
  assert.deepEqual(result.results.map(row => row.status), ['protected', 'protected', 'not-observed', 'not-observed', 'signal-sent'])
  assert.deepEqual(state.signals, [[childPid, 'SIGTERM']])
})

test('snapshot disappearance, identity change, missing ancestry and last-moment protection never signal', async () => {
  const rows = ancestry()
  for (const [fresh, inspect, status] of [
    [{ processes: rows, services: [] }, undefined, 'already-exited'],
    [{ processes: rows, services: [{ pid: childPid, processStartId: 'reused' }] }, undefined, 'identity-changed'],
    [{ processes: new Map(), services: [target(childPid)] }, undefined, 'protected'],
    [{ processes: rows, services: [target(childPid)] }, async () => new Map(), 'protected'],
    [{ processes: rows, services: [target(childPid)] }, async () => rows, 'already-exited']
  ]) {
    const state = dependencies(rows, { fresh: async () => fresh, ...(inspect ? { inspect } : {}) })
    assert.equal((await stopProcesses({ targets: [target(childPid)], force: false }, [target(childPid)], state.deps)).results[0].status, status)
    assert.deepEqual(state.signals, [])
  }
})

test('signal errors are truthful per-target results; no implicit retry or escalation', async () => {
  const rows = ancestry()
  rows.set(childPid, info(childPid, 1))
  for (const [code, status] of [['ESRCH', 'already-exited'], ['EPERM', 'permission-denied'], ['EACCES', 'permission-denied'], ['EIO', 'failed']]) {
    let attempts = 0
    const state = dependencies(rows, { signal() { attempts++; throw Object.assign(new Error('private details'), { code }) } })
    assert.deepEqual(await stopProcesses({ targets: [target(childPid)], force: false }, [target(childPid)], state.deps), {
      results: [{ ...target(childPid), status }]
    })
    assert.equal(attempts, 1)
    assert.equal(state.invalidations(), 1)
  }
})

test('Windows normal stop is explicitly unsupported; force terminates only the individual PID', async () => {
  const rows = ancestry()
  rows.set(childPid, info(childPid, 1))
  const state = dependencies(rows, { platform: 'win32' })
  assert.equal((await stopProcesses({ targets: [target(childPid)], force: false }, [target(childPid)], state.deps)).results[0].status, 'unsupported')
  assert.equal(state.invalidations(), 0)
  assert.deepEqual(state.signals, [])
  assert.equal((await stopProcesses({ targets: [target(childPid)], force: true }, [target(childPid)], state.deps)).results[0].status, 'signal-sent')
  assert.deepEqual(state.signals, [[childPid, 'SIGKILL']])
})
