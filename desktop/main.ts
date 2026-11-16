import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Utils } from 'electrobun/main'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import { externalUrl, navigationRules, startDesktopServer } from './runtime.ts'

let server: Server | undefined

Electrobun.events.on('before-quit', () => {
  // The server shares this process; native shutdown cannot leave a child behind.
  server?.close()
  server?.closeAllConnections()
})

ApplicationMenu.setApplicationMenu([
  {
    label: 'Portscope',
    submenu: [{ label: 'Quitter Portscope', action: 'quit', accelerator: 'q' }]
  },
  {
    label: 'Édition',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'divider' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]
  }
])
ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
  if ((event as { data: { action: string } }).data.action === 'quit') Utils.quit()
})

try {
  const runtime = await startDesktopServer(pathToFileURL(join(PATHS.RESOURCES_FOLDER, 'app/nuxt/server/index.mjs')))
  server = runtime.server
  const response = await fetch(runtime.origin, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Nuxt startup returned HTTP ${response.status}.`)
  await response.arrayBuffer()
  const window = new BrowserWindow({
    title: 'Portscope',
    url: `${runtime.origin}/`,
    frame: { width: 1320, height: 860 },
    titleBarStyle: 'default',
    sandbox: true,
    navigationRules: navigationRules(runtime.origin)
  })
  Electrobun.events.on(`new-window-open-${window.webview.id}`, event => {
    const url = externalUrl(event.data.detail)
    if (url) Utils.openExternal(url)
  })
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error('Portscope could not start:', detail)
  try {
    await Utils.showMessageBox({
      type: 'error',
      title: 'Portscope',
      message: 'Impossible de démarrer Portscope.',
      detail,
      buttons: ['Quitter']
    })
  } finally {
    Utils.quit()
  }
}
