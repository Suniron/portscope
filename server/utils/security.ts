export function isAllowedRequest(host: string | undefined, origin: string | undefined): boolean {
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host)) return false
  try {
    const target = new URL(`http://${host}`)
    if (origin === undefined) return true
    const source = new URL(origin)
    return source.origin === target.origin
  } catch {
    return false
  }
}

export function isAllowedMutation(
  host: string | undefined, origin: string | undefined, contentType: string | undefined, action: string | undefined, expectedAction: 'stop' | 'open' = 'stop'
): boolean {
  if (!origin || !isAllowedRequest(host, origin) || action !== expectedAction
    || !/^application\/json(?:\s*;.*)?$/i.test(contentType ?? '')) return false
  return origin === new URL(`http://${host}`).origin
}
