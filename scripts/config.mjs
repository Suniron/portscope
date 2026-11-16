export function parsePort(value = '3100') {
  if (!/^\d+$/.test(String(value))) throw new Error('PORTSCOPE_PORT must be an integer from 1 to 65535.')
  const port = Number(value)
  if (port < 1 || port > 65535) throw new Error('PORTSCOPE_PORT must be an integer from 1 to 65535.')
  return port
}

export function assertNotRoot(uid = process.getuid?.()) {
  if (uid === 0) throw new Error('Do not run Portscope as root. Choose an unprivileged port using PORTSCOPE_PORT.')
}

export function serverEnvironment(env = process.env, port = parsePort(env.PORTSCOPE_PORT)) {
  return {
    ...env,
    PORTSCOPE_PORT: String(port),
    PORT: String(port),
    NITRO_PORT: String(port),
    NUXT_PORT: String(port),
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
    NUXT_HOST: '127.0.0.1',
    NITRO_UNIX_SOCKET: '',
    NITRO_SSL_CERT: '',
    NITRO_SSL_KEY: ''
  }
}
