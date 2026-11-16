export default defineNuxtConfig({
  compatibilityDate: '2026-11-16',
  modules: ['@nuxt/ui'],
  ui: { fonts: false },
  icon: { provider: 'server', serverBundle: 'local', fallbackToApi: false },
  css: ['~/assets/css/main.css'],
  ssr: true,
  devtools: { enabled: false },
  devServer: { host: '127.0.0.1', port: 3100 },
  nitro: process.env.PORTSCOPE_DESKTOP === '1'
    ? { preset: 'node-listener', serveStatic: true, output: { dir: '.output-desktop' } }
    : { preset: 'node-server' },
  typescript: { strict: true },
  app: {
    head: {
      title: 'Portscope',
      meta: [{ name: 'description', content: 'Vos services TCP locaux, réunis au même endroit.' }],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' }
      ]
    }
  }
})
