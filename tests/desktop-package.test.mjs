import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

test('packaged Bun serves Nuxt, assets and inventory without system JS tools or a GUI', {
  skip: process.env.PORTSCOPE_TEST_DESKTOP !== '1',
  timeout: 45000
}, async t => {
  const windows = process.platform === 'win32'
  assert(['darwin', 'win32'].includes(process.platform), 'Build and test on macOS or Windows.')
  const temp = await mkdtemp(join(tmpdir(), 'portscope-desktop-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const archive = join(root, windows
    ? `artifacts/stable-win-${process.arch}-Portscope.tar.zst`
    : `artifacts/stable-macos-${process.arch}-Portscope.app.tar.zst`)
  await exec(windows ? 'tar.exe' : '/usr/bin/tar', ['-xf', archive, '-C', temp])
  const app = join(temp, windows ? 'Portscope' : 'Portscope.app/Contents')
  // The test harness is copied out too, so no import can find project node_modules.
  await cp(join(root, 'desktop/runtime.ts'), join(temp, 'desktop/runtime.ts'), { recursive: true })
  await cp(join(root, 'scripts/config.mjs'), join(temp, 'scripts/config.mjs'), { recursive: true })
  const runtime = pathToFileURL(join(temp, 'desktop/runtime.ts')).href
  const entrypoint = pathToFileURL(join(app, 'Resources/app/nuxt/server/index.mjs')).href
  const resultPath = join(temp, 'checks.txt')
  const harnessPath = join(temp, 'checks.mjs')
  await writeFile(harnessPath, `
    import assert from 'node:assert/strict'
    import { writeFile } from 'node:fs/promises'
    import { createServer } from 'node:net'
    import { once } from 'node:events'
    import { request } from 'node:http'
    await writeFile(${JSON.stringify(resultPath)}, 'harness started')
    try {
    const { startDesktopServer } = await import(${JSON.stringify(runtime)})
    const ipc = createServer()
    ipc.listen(0, '127.0.0.1')
    await once(ipc, 'listening')
    const { server, origin } = await startDesktopServer(new URL(${JSON.stringify(entrypoint)}))
    try {
      const page = await fetch(origin)
      assert.equal(page.status, 200)
      const html = await page.text()
      assert.match(html, /Portscope/)
      const assetPaths = [...html.matchAll(/(?:src|href)="(\\/_nuxt\\/[^"]+)"/g)].map(match => match[1])
      assert(assetPaths.length > 0, 'SSR must reference packaged assets')
      for (const path of [...assetPaths, '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
        const asset = await fetch(origin + path)
        assert.equal(asset.status, 200, path)
        assert((await asset.arrayBuffer()).byteLength > 0, path)
      }
      const response = await fetch(origin + '/api/inventory')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
      const inventory = await response.json()
      const own = inventory.services.find(service => service.pid === process.pid)
      assert(own, 'bundled runtime must collect its own listener')
      assert(own.endpoints.some(endpoint => endpoint.url === origin))
      const ipcEndpoint = own.endpoints.find(endpoint => endpoint.port === ipc.address().port)
      assert(ipcEndpoint, 'same-process IPC listener must remain visible')
      assert.equal(ipcEndpoint.url, null, 'IPC must not be advertised as HTTP')
      for (const headers of [
        { Host: 'rebind.example' }, { Origin: 'http://evil.example' }, { Origin: 'null' }
      ]) {
        const status = await new Promise((resolve, reject) => {
          const req = request(origin + '/api/inventory', { headers }, res => {
            res.resume()
            resolve(res.statusCode)
          })
          req.on('error', reject)
          req.end()
        })
        assert.equal(status, 403)
      }
      await writeFile(${JSON.stringify(resultPath)}, 'checks passed')
    } finally {
      ipc.close()
      server.close()
      server.closeAllConnections()
    }
    } catch (error) {
      await writeFile(${JSON.stringify(resultPath)}, error.stack ?? String(error))
      process.exitCode = 1
    }
  `)
  await exec(join(app, windows ? 'bin/bun.exe' : 'MacOS/bun'), [harnessPath], {
    cwd: temp,
    // Keep Windows system variables required by CIM; only JS tool discovery is removed.
    env: {
      ...process.env,
      PATH: '', LANG: 'en_US.UTF-8', NODE_ENV: 'production'
    },
    timeout: 30000
  }).catch(async error => {
    error.message += '\nPackaged checks: ' + await readFile(resultPath, 'utf8').catch(() => 'harness did not start')
    throw error
  })
  // Packaged Windows runtimes may not expose console output to the parent.
  assert.equal(await readFile(resultPath, 'utf8'), 'checks passed')
})
