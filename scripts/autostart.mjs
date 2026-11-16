import { execFile } from 'node:child_process'
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { assertNotRoot, parsePort } from './config.mjs'

const exec = promisify(execFile)
const label = 'local.portscope'
const marker = 'Managed by Portscope'
const xml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[char])

function safePath(value) {
  if (/[\0-\x1f\x7f]/.test(value) || !value.startsWith('/')) throw new Error('Autostart paths must be absolute and contain no control characters.')
  return value
}

// systemd expands % specifiers and $ variables even in double-quoted ExecStart arguments.
export function unitArgument(value) {
  return `"${safePath(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, () => '$$')}"`
}

export function generateAutostart({
  platform = process.platform,
  home = homedir(),
  root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''),
  node = process.execPath,
  port = parsePort(process.env.PORTSCOPE_PORT)
} = {}) {
  port = parsePort(port)
  for (const path of [home, root, node]) safePath(path)
  const script = join(root, 'scripts/start.mjs')
  if (platform === 'darwin') {
    const logs = join(home, 'Library/Logs/Portscope')
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <!-- ${marker} -->
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PORTSCOPE_PORT</key><string>${port}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(join(logs, 'stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, 'stderr.log'))}</string>
</dict></plist>
`
    return { path: join(home, 'Library/LaunchAgents', `${label}.plist`), content, logs }
  }
  if (platform === 'linux') {
    // WorkingDirectory supports % specifiers, but does not expand environment variables.
    const directory = unitArgument(root).replace(/\$\$/g, '$')
    const content = `# ${marker}
[Unit]
Description=Portscope local service inventory
[Service]
Type=simple
WorkingDirectory=${directory}
ExecStart=${unitArgument(node)} ${unitArgument(script)}
Environment=PORTSCOPE_PORT=${port}
Restart=no
UMask=0077

[Install]
WantedBy=default.target
`
    return { path: join(home, '.config/systemd/user/portscope.service'), content, logs: null }
  }
  throw new Error('Autostart supports macOS launchd and Linux systemd --user only.')
}

export async function assertOwned(path) {
  let existing
  try { existing = await readFile(path, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
  if (!existing.includes(marker)) throw new Error('Refusing to modify an existing service file not managed by Portscope.')
  return true
}

export async function autostart(args = process.argv.slice(2)) {
  assertNotRoot()
  const [action, ...flags] = args
  if (!['install', 'uninstall'].includes(action) || flags.some(flag => flag !== '--dry-run') || flags.length > 1) {
    throw new Error('Usage: pnpm autostart <install|uninstall> [--dry-run]. Set PORTSCOPE_PORT to configure the listening port.')
  }
  const generated = generateAutostart()
  const dry = flags.includes('--dry-run')
  if (dry) {
    console.log(`${action}: ${generated.path}\n${generated.content}`)
    console.log('Dry run only: no files written and no user services changed.')
    return
  }
  const exists = await assertOwned(generated.path)
  const run = (command, argv) => exec(command, argv, { timeout: 15000, maxBuffer: 256 * 1024 })
  if (action === 'install') {
    await access(new URL('../.output/server/index.mjs', import.meta.url)).catch(() => {
      throw new Error('Run pnpm build before installing autostart.')
    })
    // Refuse replacement: explicit uninstall keeps reconfiguration predictable.
    if (exists) throw new Error('Portscope autostart already exists. Uninstall it before reinstalling.')
    const { checkPort } = await import('./start.mjs')
    await checkPort(parsePort(process.env.PORTSCOPE_PORT))
    await mkdir(dirname(generated.path), { recursive: true, mode: 0o700 })
    if (generated.logs) await mkdir(generated.logs, { recursive: true, mode: 0o700 })
    await writeFile(generated.path, generated.content, { flag: 'wx', mode: 0o600 })
    try {
      if (process.platform === 'darwin') {
        await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, generated.path])
      } else {
        await run('systemctl', ['--user', 'daemon-reload'])
        await run('systemctl', ['--user', 'enable', '--now', 'portscope.service'])
      }
    } catch {
      throw new Error(`Autostart activation failed. The owned file remains at ${generated.path}; inspect the user-service logs, then run pnpm autostart uninstall before retrying.`)
    }
    console.log('Portscope autostart installed for the current user session.')
    return
  }
  if (!exists) { console.log('No Portscope autostart file found; nothing changed.'); return }
  try {
    if (process.platform === 'darwin') {
      // Query first: an unloaded service does not need bootout.
      const loaded = await run('launchctl', ['print', `gui/${process.getuid()}/${label}`]).then(() => true, () => false)
      if (loaded) await run('launchctl', ['bootout', `gui/${process.getuid()}`, generated.path])
    } else {
      await run('systemctl', ['--user', 'disable', '--now', 'portscope.service'])
    }
    await unlink(generated.path)
    if (process.platform === 'linux') await run('systemctl', ['--user', 'daemon-reload'])
  } catch {
    throw new Error('Autostart removal failed. Inspect the user-service state before retrying; no unrelated service was targeted.')
  }
  console.log('Portscope autostart removed. Build files and logs were preserved.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  autostart().catch(error => { console.error(error.message); process.exitCode = 1 })
}
