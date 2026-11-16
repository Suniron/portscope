import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const electrobun = join(root, 'node_modules/electrobun/bin/electrobun.cjs')

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, HUTCH_HOME: join(root, '.hutch/store'), ...env }
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/desktop.mjs build|start|test')
  switch (process.argv[2]) {
    case 'build':
      run([join(root, 'node_modules/nuxt/bin/nuxt.mjs'), 'build'], { PORTSCOPE_DESKTOP: '1' })
      run([electrobun, 'build', '--env=stable'])
      break
    case 'start':
      run([electrobun, 'run', '--env=stable'])
      break
    case 'test':
      run(['--test', 'tests/desktop.test.mjs', 'tests/desktop-package.test.mjs'], { PORTSCOPE_TEST_DESKTOP: '1' })
      break
    default:
      throw new Error('Usage: node scripts/desktop.mjs build|start|test')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
