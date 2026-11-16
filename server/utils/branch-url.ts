/** Normalize known forge URLs without ever returning clone credentials or URL parameters. */
export function branchWebUrl(remote: string, mergeRef: string): string | null {
  if (!mergeRef.startsWith('refs/heads/') || mergeRef.length === 'refs/heads/'.length) return null
  try {
    let parsed: URL
    if (/^(?:https?|ssh):\/\//i.test(remote)) {
      parsed = new URL(remote)
    } else {
      const scp = /^(?:[^@\s/:]+@)?([^/\s:]+):(.+)$/.exec(remote)
      if (!scp) return null
      parsed = new URL(`ssh://${scp[1]}/${scp[2]}`)
    }
    const host = parsed.hostname.toLowerCase()
    if (!['github.com', 'gitlab.com', 'bitbucket.org'].includes(host)) return null
    const segments = parsed.pathname.replace(/^\/|\/$/g, '').split('/').map(decodeURIComponent)
    if (segments.length < 2 || (host !== 'gitlab.com' && segments.length !== 2)) return null
    segments[segments.length - 1] = segments.at(-1)!.replace(/\.git$/, '')
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\/\x00-\x1f\x7f]/.test(segment))) return null
    const path = segments.map(encodeURIComponent).join('/')
    const branch = encodeURIComponent(mergeRef.slice('refs/heads/'.length))
    const route = host === 'gitlab.com' ? '-/tree' : host === 'bitbucket.org' ? 'src' : 'tree'
    return `https://${host}/${path}/${route}/${branch}`
  } catch {
    return null
  }
}
