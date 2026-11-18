import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeStopStatus,
  extractStopTargets,
  filterServices,
  formatBytes,
  formatCpu,
  formatDuration,
  getServiceTargetKey,
  getStopDisabledReason,
  isStopEligible,
  pruneSelection,
  sortServices,
} from '../app/utils/process-controls.ts'

const makeService = (overrides = {}) => ({
  id: 'srv-1',
  pid: 1234,
  processName: 'node',
  processStartId: 'start-1234',
  startedAt: '2026-11-17T10:00:00.000Z',
  metrics: { rssBytes: 52_428_800, cpuPercent: 4.5 },
  stopDisabledReason: null,
  cwd: '/workspace/project',
  project: {
    root: '/workspace/project',
    name: 'project',
    branch: 'main',
    branchUrl: 'https://github.com/org/repo/tree/main',
    worktree: null,
  },
  endpoints: [{ address: '127.0.0.1', port: 3000, family: 'IPv4', url: null }],
  ...overrides,
})

test('formatDuration formats seconds, minutes and hours in compact French', () => {
  const base = Date.parse('2026-11-17T10:00:00.000Z')
  assert.equal(formatDuration(null, base), '—')
  assert.equal(formatDuration('invalid-date', base), '—')
  assert.equal(formatDuration('2026-11-17T09:59:18.000Z', base), '42 s')
  assert.equal(formatDuration('2026-11-17T09:52:00.000Z', base), '8 min')
  assert.equal(formatDuration('2026-11-17T07:45:00.000Z', base), '2 h 15 min')
  assert.equal(formatDuration('2026-11-17T08:00:00.000Z', base), '2 h')
  assert.equal(formatDuration('2026-11-15T08:00:00.000Z', base), '2 j 2 h')
})

test('formatBytes formats Mo and Go with French formatting and em dash for null', () => {
  assert.equal(formatBytes(null), '—')
  assert.equal(formatBytes(undefined), '—')
  assert.equal(formatBytes(-10), '—')
  assert.equal(formatBytes(0), '0 Mo')
  assert.equal(formatBytes(500 * 1024), '< 1 Mo')
  assert.equal(formatBytes(50 * 1024 * 1024), '50 Mo')
  assert.equal(formatBytes(150 * 1024 * 1024), '150 Mo')
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1,5 Go')
})

test('formatCpu formats percentage with fr decimals and em dash for null', () => {
  assert.equal(formatCpu(null), '—')
  assert.equal(formatCpu(undefined), '—')
  assert.equal(formatCpu(0), '0,0 %')
  assert.equal(formatCpu(12.5), '12,5 %')
  assert.equal(formatCpu(100), '100,0 %')
})

test('isStopEligible and getStopDisabledReason handle protected, identity-unavailable and missing identity', () => {
  const normal = makeService()
  assert.equal(isStopEligible(normal), true)
  assert.equal(getStopDisabledReason(normal), null)

  const protectedSrv = makeService({ stopDisabledReason: 'protected' })
  assert.equal(isStopEligible(protectedSrv), false)
  assert.equal(getStopDisabledReason(protectedSrv), 'protected')

  const noStartId = makeService({ processStartId: null })
  assert.equal(isStopEligible(noStartId), false)
  assert.equal(getStopDisabledReason(noStartId), 'identity-unavailable')

  const noPid = makeService({ pid: null })
  assert.equal(isStopEligible(noPid), false)
  assert.equal(getStopDisabledReason(noPid), 'identity-unavailable')
})

test('pruneSelection keeps only visible eligible services and drops changed identities or filtered items', () => {
  const s1 = makeService({ id: 's1', pid: 100, processStartId: 'start-100' })
  const s2 = makeService({ id: 's2', pid: 200, processStartId: 'start-200' })
  const s3 = makeService({ id: 's3', pid: 300, processStartId: 'start-300', stopDisabledReason: 'protected' })

  const initialSelected = new Set(['100:start-100', '200:start-200', '300:start-300', '999:unknown'])
  // Visible: s1 and s2 and s3 (s3 is protected so not eligible)
  const pruned1 = pruneSelection(initialSelected, [s1, s2, s3])
  assert.deepEqual([...pruned1], ['100:start-100', '200:start-200'])

  // Now s2 identity changed (process restarted with new startId)
  const s2New = makeService({ id: 's2', pid: 200, processStartId: 'start-200-restarted' })
  const pruned2 = pruneSelection(pruned1, [s1, s2New])
  assert.deepEqual([...pruned2], ['100:start-100'])

  // Now s1 filtered out (empty visible)
  const pruned3 = pruneSelection(pruned2, [])
  assert.equal(pruned3.size, 0)
})

test('extractStopTargets dedups by pid:processStartId and ignores unselected or ineligible', () => {
  const s1a = makeService({ id: 's1a', pid: 100, processStartId: 'start-100' })
  const s1b = makeService({ id: 's1b', pid: 100, processStartId: 'start-100' }) // same process, e.g. different port
  const s2 = makeService({ id: 's2', pid: 200, processStartId: 'start-200' })

  const targets = extractStopTargets(new Set(['100:start-100']), [s1a, s1b, s2])
  assert.deepEqual(targets, [{ pid: 100, processStartId: 'start-100' }])
})

test('filterServices filters by query and onlyWithGit (branch or worktree)', () => {
  const gitBranch = makeService({
    id: '1',
    processName: 'api',
    project: { name: 'api', branch: 'feat/test', worktree: null },
  })
  const gitWorktree = makeService({
    id: '2',
    processName: 'web',
    project: { name: 'web', branch: null, worktree: 'worktrees/wt1' },
  })
  const nonGit = makeService({
    id: '3',
    processName: 'daemon',
    project: null,
  })

  const list = [gitBranch, gitWorktree, nonGit]

  assert.equal(filterServices(list, '', false).length, 3)
  assert.deepEqual(filterServices(list, '', true).map(s => s.id), ['1', '2'])
  assert.deepEqual(filterServices(list, 'daemon', true).map(s => s.id), [])
  assert.deepEqual(filterServices(list, 'daemon', false).map(s => s.id), ['3'])
  assert.deepEqual(filterServices(list, 'feat', true).map(s => s.id), ['1'])
})

test('sortServices sorts correctly by port, name and duration', () => {
  const s1 = makeService({
    id: '1',
    processName: 'charlie',
    project: { name: 'charlie', branch: null, worktree: null },
    endpoints: [{ port: 8080 }],
    startedAt: '2026-11-17T09:00:00.000Z',
  })
  const s2 = makeService({
    id: '2',
    processName: 'alpha',
    project: { name: 'alpha', branch: null, worktree: null },
    endpoints: [{ port: 3000 }],
    startedAt: '2026-11-17T10:00:00.000Z',
  })
  const s3 = makeService({
    id: '3',
    processName: 'bravo',
    project: { name: 'bravo', branch: null, worktree: null },
    endpoints: [{ port: 5000 }],
    startedAt: null,
  })

  const list = [s1, s2, s3]

  // Port asc
  assert.deepEqual(sortServices(list, 'port', 'asc').map(s => s.id), ['2', '3', '1'])
  // Port desc
  assert.deepEqual(sortServices(list, 'port', 'desc').map(s => s.id), ['1', '3', '2'])

  // Name asc
  assert.deepEqual(sortServices(list, 'name', 'asc').map(s => s.id), ['2', '3', '1'])
  // Name desc
  assert.deepEqual(sortServices(list, 'name', 'desc').map(s => s.id), ['1', '3', '2'])

  // Duration asc (shortest running first => most recent start time first)
  assert.deepEqual(sortServices(list, 'duration', 'asc').map(s => s.id), ['2', '1', '3'])
  // Duration desc (longest running first => earliest start time first)
  assert.deepEqual(sortServices(list, 'duration', 'desc').map(s => s.id), ['1', '2', '3'])
})

test('CPU and RAM sort numerically in both directions with unknown measurements last', () => {
  const list = [
    makeService({ id: 'large', metrics: { cpuPercent: 112, rssBytes: 2 * 1024 ** 3 } }),
    makeService({ id: 'unknown', metrics: { cpuPercent: null, rssBytes: null } }),
    makeService({ id: 'small', metrics: { cpuPercent: 2, rssBytes: 20 * 1024 ** 2 } }),
    makeService({ id: 'invalid', metrics: { cpuPercent: NaN, rssBytes: Infinity } }),
    makeService({ id: 'medium', metrics: { cpuPercent: 10, rssBytes: 100 * 1024 ** 2 } }),
    makeService({ id: 'zero', metrics: { cpuPercent: 0, rssBytes: 0 } }),
    makeService({ id: 'missing', metrics: undefined }),
  ]
  for (const field of ['cpu', 'ram']) {
    assert.deepEqual(sortServices(list, field, 'asc').map(s => s.id),
      ['zero', 'small', 'medium', 'large', 'unknown', 'invalid', 'missing'])
    assert.deepEqual(sortServices(list, field, 'desc').map(s => s.id),
      ['large', 'medium', 'small', 'zero', 'unknown', 'invalid', 'missing'])
  }
  assert.equal(list[0].id, 'large', 'sorting must not mutate the inventory')
})

test('describeStopStatus accurately describes statuses and distinguishes signal vs failure', () => {
  assert.equal(describeStopStatus('signal-sent').isExitOrSignal, true)
  assert.equal(describeStopStatus('already-exited').isExitOrSignal, true)
  assert.equal(describeStopStatus('permission-denied').isExitOrSignal, false)
  assert.equal(describeStopStatus('unsupported').isExitOrSignal, false)
  assert.ok(describeStopStatus('unsupported').actionHint?.includes('Forcer'))
})

test('preserves failed stop targets in selection for retry and adds failed unselected targets', () => {
  const selected = new Set(['100:start-100'])
  const results = [
    { pid: 100, processStartId: 'start-100', status: 'signal-sent' },
    { pid: 200, processStartId: 'start-200', status: 'unsupported' },
    { pid: 300, processStartId: 'start-300', status: 'permission-denied' },
  ]
  const updatedSelection = new Set(selected)
  for (const res of results) {
    const desc = describeStopStatus(res.status)
    const key = `${res.pid}:${res.processStartId}`
    if (desc.isExitOrSignal) {
      updatedSelection.delete(key)
    } else {
      updatedSelection.add(key)
    }
  }
  assert.deepEqual([...updatedSelection], ['200:start-200', '300:start-300'])
})
