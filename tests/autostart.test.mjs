import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertOwned, generateAutostart, unitArgument } from '../scripts/autostart.mjs'

const options = {
  home: '/Users/Test Person',
  root: '/Users/Test Person/projects/a & <b> "quoted" $var%project',
  node: '/Users/Test Person/node/bin/node',
  port: 3100
}

test('launchd handles spaces/XML characters and uses user-only loopback start wrapper', () => {
  const result = generateAutostart({ ...options, platform: 'darwin' })
  assert.equal(result.path, '/Users/Test Person/Library/LaunchAgents/local.portscope.plist')
  assert(result.content.includes('a &amp; &lt;b&gt; &quot;quoted&quot;'))
  assert(result.content.includes('<string>3100</string>'))
  assert(!result.content.includes('<key>UserName</key>'))
  assert(!result.content.includes('sudo'))
  if (process.platform === 'darwin') {
    assert.match(execFileSync('plutil', ['-lint', '-'], { input: result.content, encoding: 'utf8' }), /OK/)
  }
})

test('systemd quotes paths, escapes specifiers/variables, and does not enable linger', () => {
  const result = generateAutostart({ ...options, platform: 'linux' })
  assert.equal(result.path, '/Users/Test Person/.config/systemd/user/portscope.service')
  assert(result.content.includes('ExecStart="/Users/Test Person/node/bin/node" '))
  assert(result.content.includes('$$var%%project/scripts/start.mjs"'))
  assert(result.content.includes('WorkingDirectory="/Users/Test Person/projects/a & <b> \\"quoted\\" $var%%project"'))
  assert(result.content.includes('Environment=PORTSCOPE_PORT=3100'))
  assert(!result.content.includes('sudo'))
  assert(!result.content.includes('linger'))
  assert.equal(unitArgument('/path/with\\slash'), '"/path/with\\\\slash"')
  assert.throws(() => unitArgument('/bad\npath'), /control/)
  assert.throws(() => generateAutostart({ platform: 'win32' }), /macOS.*Linux/)
})

test('ownership checks preserve unrelated user service files', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'portscope-autostart-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const path = join(temp, 'unrelated.service')
  assert.equal(await assertOwned(path), false)
  await writeFile(path, '[Service]\nExecStart=/usr/bin/true\n')
  await assert.rejects(assertOwned(path), /Refusing/)
  assert.equal(await readFile(path, 'utf8'), '[Service]\nExecStart=/usr/bin/true\n')
  await writeFile(path, generateAutostart({ ...options, platform: 'linux' }).content)
  assert.equal(await assertOwned(path), true)
})

test('native CLI dry-run has no side effects and preserves default port 3100', () => {
  const env = { ...process.env }
  delete env.PORTSCOPE_PORT
  const output = execFileSync(process.execPath, ['scripts/autostart.mjs', 'install', '--dry-run'], {
    cwd: new URL('../', import.meta.url), env, encoding: 'utf8'
  })
  assert(output.includes('Dry run only: no files written'))
  assert(output.includes(process.platform === 'darwin' ? '<string>3100</string>' : 'PORTSCOPE_PORT=3100'))
})
