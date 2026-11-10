import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { PullRequestConfig, PullRequestProvider, RemoteInfo, RepoConfig, RepoSettings } from '../../shared/protocol'
import { git, gitTry } from './run'

export const CONFIG_FILE = path.join('.orca', 'git-graph.json')

export function emptyConfig(): RepoConfig {
  return { issueLinking: null, pullRequest: null, hideRemotes: [] }
}

const PROVIDERS: readonly PullRequestProvider[] = ['github', 'gitlab', 'bitbucket', 'custom']

const configKey = (cwd: string): string => `config:${cwd}`

/** Coerces untrusted JSON into a RepoConfig, dropping what does not fit. */
export function sanitiseConfig(value: unknown): RepoConfig {
  const config = emptyConfig()
  if (typeof value !== 'object' || value === null) return config
  const raw = value as Record<string, unknown>
  const issue = raw.issueLinking as Record<string, unknown> | null | undefined
  if (issue && typeof issue.issue === 'string' && typeof issue.url === 'string') {
    config.issueLinking = { issue: issue.issue, url: issue.url }
  }
  const pr = raw.pullRequest as Record<string, unknown> | null | undefined
  if (pr && typeof pr.provider === 'string' && PROVIDERS.includes(pr.provider as PullRequestProvider)) {
    const str = (key: string): string => (typeof pr[key] === 'string' ? (pr[key] as string) : '')
    const parsed: PullRequestConfig = {
      provider: pr.provider as PullRequestProvider,
      hostRootUrl: str('hostRootUrl'),
      sourceOwner: str('sourceOwner'),
      sourceRepo: str('sourceRepo'),
      sourceRemote: str('sourceRemote'),
      destOwner: str('destOwner'),
      destRepo: str('destRepo'),
      destBranch: str('destBranch'),
      destRemote: typeof pr.destRemote === 'string' ? pr.destRemote : null
    }
    if (typeof pr.customTemplate === 'string') parsed.customTemplate = pr.customTemplate
    config.pullRequest = parsed
  }
  if (Array.isArray(raw.hideRemotes)) {
    config.hideRemotes = raw.hideRemotes.filter((entry): entry is string => typeof entry === 'string')
  }
  return config
}

async function readConfigFile(cwd: string): Promise<RepoConfig | null> {
  try {
    return sanitiseConfig(JSON.parse(await readFile(path.join(cwd, CONFIG_FILE), 'utf8')))
  } catch {
    return null
  }
}

/** Stored config, falling back to `.orca/git-graph.json` when storage has none. */
export async function loadConfig(orca: OrcaWorkerApi, cwd: string): Promise<RepoConfig> {
  let stored: unknown = null
  try {
    stored = await orca.storage.get(configKey(cwd))
  } catch {
    // storage:own not granted
  }
  if (stored !== null) return sanitiseConfig(stored)
  return (await readConfigFile(cwd)) ?? emptyConfig()
}

export async function saveConfig(orca: OrcaWorkerApi, cwd: string, config: RepoConfig): Promise<void> {
  await orca.storage.set(configKey(cwd), sanitiseConfig(config) as never)
}

/** Writes the stored config to `<repo>/.orca/git-graph.json`; returns the repo-relative path. */
export async function exportConfig(orca: OrcaWorkerApi, cwd: string): Promise<string> {
  const config = await loadConfig(orca, cwd)
  await mkdir(path.join(cwd, '.orca'), { recursive: true })
  await writeFile(path.join(cwd, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n', 'utf8')
  return CONFIG_FILE.split(path.sep).join('/')
}

export async function readRepoSettings(orca: OrcaWorkerApi, cwd: string, signal: AbortSignal): Promise<RepoSettings> {
  const [remotes, local, global, config] = await Promise.all([
    readRemotes(cwd, signal),
    readUser(cwd, 'local', signal),
    readUser(cwd, 'global', signal),
    loadConfig(orca, cwd)
  ])
  return { remotes, user: { local, global }, config }
}

async function readRemotes(cwd: string, signal: AbortSignal): Promise<RemoteInfo[]> {
  const names = (await git(cwd, ['remote'], { signal })).split('\n').filter((name) => name !== '')
  return Promise.all(
    names.map(async (name) => {
      const [url, pushUrl] = await Promise.all([
        gitTry(cwd, ['remote', 'get-url', name], { signal }),
        gitTry(cwd, ['remote', 'get-url', '--push', name], { signal })
      ])
      const fetchUrl = url === null ? null : url.trim()
      const push = pushUrl === null ? null : pushUrl.trim()
      return { name, url: fetchUrl, pushUrl: push !== null && push !== fetchUrl ? push : null }
    })
  )
}

async function readUser(
  cwd: string,
  scope: 'local' | 'global',
  signal: AbortSignal
): Promise<{ name: string | null; email: string | null }> {
  const read = async (key: string): Promise<string | null> => {
    const out = await gitTry(cwd, ['config', `--${scope}`, '--get', key], { signal })
    const value = out === null ? '' : out.trim()
    return value === '' ? null : value
  }
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  return { name, email }
}
