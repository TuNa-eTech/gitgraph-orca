import type { PullRequestConfig, PullRequestProvider, RemoteInfo } from '../../../shared/protocol'

export type ParsedRemote = { hostRootUrl: string; host: string; owner: string; repo: string }

/** Parses ssh (`git@host:owner/repo.git`, `ssh://…`) and http(s) remote URLs. Returns null for anything else. */
export function parseRemoteUrl(url: string | null): ParsedRemote | null {
  if (!url) return null
  const trimmed = url.trim()
  let host: string
  let path: string
  let protocol = 'https'

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(trimmed)
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    host = scp[1]
    path = scp[2]
  } else {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (!parsed.hostname) return null
    host = parsed.hostname
    path = parsed.pathname
    if (parsed.protocol === 'http:') protocol = 'http'
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.port) host = `${host}:${parsed.port}`
  }

  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter((s) => s !== '')
  if (segments.length < 2) return null
  const repo = segments[segments.length - 1]
  const owner = segments.slice(0, -1).join('/')
  return { hostRootUrl: `${protocol}://${host}`, host, owner, repo }
}

export function detectProvider(host: string): PullRequestProvider {
  const h = host.toLowerCase()
  if (h.includes('gitlab')) return 'gitlab'
  if (h.includes('bitbucket')) return 'bitbucket'
  return 'github'
}

/** A starting configuration derived from the repository's remotes; null when no remote URL can be parsed. */
export function defaultPullRequestConfig(remotes: RemoteInfo[], branches: string[]): PullRequestConfig | null {
  const ordered = [...remotes].sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'))
  for (const remote of ordered) {
    const parsed = parseRemoteUrl(remote.url)
    if (!parsed) continue
    const destBranch = ['main', 'master'].find((b) => branches.includes(b)) ?? branches[0] ?? 'main'
    return {
      provider: detectProvider(parsed.host),
      hostRootUrl: parsed.hostRootUrl,
      sourceOwner: parsed.owner,
      sourceRepo: parsed.repo,
      sourceRemote: remote.name,
      destOwner: parsed.owner,
      destRepo: parsed.repo,
      destBranch,
      destRemote: remote.name,
    }
  }
  return null
}

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

/**
 * Custom template placeholders:
 * $1 host root URL, $2 source owner, $3 source repo, $4 source branch,
 * $5 destination owner, $6 destination repo, $7 destination branch, $8 destination remote.
 */
export const CUSTOM_TEMPLATE_HELP =
  '$1 host URL, $2 source owner, $3 source repo, $4 source branch, $5 dest owner, $6 dest repo, $7 dest branch, $8 dest remote'

export function buildPullRequestUrl(config: PullRequestConfig, sourceBranch: string): string {
  const host = config.hostRootUrl.replace(/\/+$/, '')
  const src = encodeRef(sourceBranch)
  const dest = encodeRef(config.destBranch)
  switch (config.provider) {
    case 'github':
      return `${host}/${config.destOwner}/${config.destRepo}/compare/${dest}...${encodeURIComponent(config.sourceOwner)}:${src}`
    case 'gitlab':
      return (
        `${host}/${config.destOwner}/${config.destRepo}/-/merge_requests/new` +
        `?merge_request[source_branch]=${encodeURIComponent(sourceBranch)}` +
        `&merge_request[target_branch]=${encodeURIComponent(config.destBranch)}`
      )
    case 'bitbucket':
      return (
        `${host}/${config.destOwner}/${config.destRepo}/pull-requests/new` +
        `?source=${encodeURIComponent(`${config.sourceOwner}/${config.sourceRepo}::${sourceBranch}`)}` +
        `&dest=${encodeURIComponent(`${config.destOwner}/${config.destRepo}::${config.destBranch}`)}`
      )
    case 'custom': {
      const values = [
        host,
        config.sourceOwner,
        config.sourceRepo,
        sourceBranch,
        config.destOwner,
        config.destRepo,
        config.destBranch,
        config.destRemote ?? '',
      ]
      return (config.customTemplate ?? '').replace(/\$([1-8])/g, (_, n: string) => {
        const v = values[Number(n) - 1]
        return n === '1' ? v : encodeURIComponent(v)
      })
    }
  }
}
