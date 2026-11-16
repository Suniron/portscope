import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'Portscope',
    identifier: 'local.portscope.desktop',
    version: '1.0.0',
    description: 'Vos services TCP locaux, réunis au même endroit.'
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'desktop/main.ts' },
    copy: { '.output-desktop': 'nuxt' },
    win: { icon: 'desktop/assets/Portscope.ico' },
    mac: {
      icons: 'desktop/assets/Portscope.iconset',
      codesign: false,
      notarize: false,
      createDmg: false
    }
  },
  runtime: { exitOnLastWindowClosed: true },
  release: { generatePatch: false }
} satisfies ElectrobunConfig
