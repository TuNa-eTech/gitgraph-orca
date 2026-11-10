import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type {
  ActionResult,
  GitAction,
  GraphData,
  PullRequestConfig,
  PullRequestProvider,
  RemoteInfo,
  RepoConfig,
  RepoSettings as RepoSettingsData,
} from '../../../shared/protocol'
import { Modal } from './Dialog'
import { CUSTOM_TEMPLATE_HELP, defaultPullRequestConfig } from './pullRequest'
import { request } from '../../request'

type Props = {
  repoPath?: string
  graph: GraphData
  /** Runs a git action and returns its result; the caller handles auth prompts. */
  run: (action: GitAction) => Promise<ActionResult>
  onClose: () => void
  /** Called when something changed that the graph should reload for (remotes, fetch). */
  onChanged: () => void
}

type RemoteDraft = { oldName: string | null; name: string; url: string; pushUrl: string; fetch: boolean }

type UserDraft = { name: string; email: string }

const PROVIDERS: { value: PullRequestProvider; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'bitbucket', label: 'Bitbucket' },
  { value: 'custom', label: 'Custom' },
]

/** Expands `$1`…`$9` in the URL template with the issue regex's capture groups (`$0` = whole match). */
export function expandIssueUrl(url: string, match: RegExpExecArray): string {
  return url.replace(/\$([0-9])/g, (_, n: string) => match[Number(n)] ?? '')
}

function compileIssueRegex(source: string): { regex: RegExp | null; error: string | null } {
  if (source === '') return { regex: null, error: null }
  try {
    return { regex: new RegExp(source), error: null }
  } catch (error) {
    return { regex: null, error: error instanceof Error ? error.message : 'Invalid regular expression.' }
  }
}

function Row(props: { label: string; children: ComponentChildren }) {
  return (
    <label class="act-row">
      <span class="act-row-label">{props.label}</span>
      {props.children}
    </label>
  )
}

function TextInput(props: { value: string; onInput: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <input
      type="text"
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      spellcheck={false}
      onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
    />
  )
}

function userDraft(u: { name: string | null; email: string | null }): UserDraft {
  return { name: u.name ?? '', email: u.email ?? '' }
}

export function RepoSettingsDialog(props: Props) {
  const { repoPath, graph, run, onClose, onChanged } = props
  const [data, setData] = useState<RepoSettingsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [remoteDraft, setRemoteDraft] = useState<RemoteDraft | null>(null)
  const [users, setUsers] = useState<{ local: UserDraft; global: UserDraft }>({
    local: { name: '', email: '' },
    global: { name: '', email: '' },
  })
  const [issueRegex, setIssueRegex] = useState('')
  const [issueUrl, setIssueUrl] = useState('')
  const [issueSample, setIssueSample] = useState('')
  const [pr, setPr] = useState<PullRequestConfig | null>(null)
  const [hidden, setHidden] = useState<string[]>([])

  const apply = (settings: RepoSettingsData) => {
    setData(settings)
    setUsers({ local: userDraft(settings.user.local), global: userDraft(settings.user.global) })
    setIssueRegex(settings.config.issueLinking?.issue ?? '')
    setIssueUrl(settings.config.issueLinking?.url ?? '')
    setPr(settings.config.pullRequest)
    setHidden(settings.config.hideRemotes)
  }

  const reload = async () => {
    try {
      apply(await request('repo.settings', { repoPath }))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath])

  /** Wraps a task with busy + error reporting. */
  const task = async (fn: () => Promise<void>) => {
    setBusy(true)
    setStatus(null)
    try {
      await fn()
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const runAction = (action: GitAction, success: string, refreshGraph: boolean) =>
    task(async () => {
      const result = await run(action)
      if (result.status !== 'ok') {
        setStatus({ kind: 'error', text: result.message })
        return
      }
      await reload()
      if (refreshGraph) onChanged()
      setStatus({ kind: 'info', text: success })
    })

  if (loadError) {
    return (
      <Modal title="Repository Settings" onClose={onClose} footer={<button type="button" onClick={onClose}>Close</button>}>
        <div class="act-error">{loadError}</div>
      </Modal>
    )
  }
  if (!data) {
    return (
      <Modal title="Repository Settings" onClose={onClose}>
        <div class="act-message">Loading…</div>
      </Modal>
    )
  }

  const issue = compileIssueRegex(issueRegex)
  const sampleMatch = issue.regex ? issue.regex.exec(issueSample) : null
  const issuePreview = sampleMatch && issueUrl ? expandIssueUrl(issueUrl, sampleMatch) : null
  const issueIncomplete = (issueRegex !== '') !== (issueUrl !== '')
  const issueInvalid = issue.error !== null || issueIncomplete
  const customMissing = pr?.provider === 'custom' && (pr.customTemplate ?? '').trim() === ''

  const setPrField = <K extends keyof PullRequestConfig>(key: K, value: PullRequestConfig[K]) =>
    setPr((cur) => (cur ? { ...cur, [key]: value } : cur))

  const remoteNames = data.remotes.map((r) => r.name)
  const draftError = (() => {
    if (!remoteDraft) return null
    if (remoteDraft.name.trim() === '' || /\s/.test(remoteDraft.name)) return 'Remote name is required and cannot contain whitespace.'
    if (remoteDraft.name !== remoteDraft.oldName && remoteNames.includes(remoteDraft.name)) return 'A remote with that name already exists.'
    if (remoteDraft.url.trim() === '') return 'URL is required.'
    return null
  })()

  const saveRemote = async () => {
    if (!remoteDraft || draftError) return
    const pushUrl = remoteDraft.pushUrl.trim() || undefined
    const action: GitAction =
      remoteDraft.oldName === null
        ? { kind: 'remote.add', name: remoteDraft.name, url: remoteDraft.url.trim(), pushUrl, fetch: remoteDraft.fetch }
        : { kind: 'remote.edit', oldName: remoteDraft.oldName, name: remoteDraft.name, url: remoteDraft.url.trim(), pushUrl }
    await runAction(action, remoteDraft.oldName === null ? 'Remote added.' : 'Remote updated.', true)
    setRemoteDraft(null)
  }

  const deleteRemote = (r: RemoteInfo) => {
    if (!window.confirm(`Delete remote "${r.name}"?`)) return
    void runAction({ kind: 'remote.delete', name: r.name }, 'Remote deleted.', true)
  }

  const setUser = (scope: 'local' | 'global') => {
    const u = users[scope]
    void runAction({ kind: 'user.set', scope, name: u.name.trim(), email: u.email.trim() }, `${scope} user saved.`, false)
  }

  const save = () =>
    task(async () => {
      if (issueInvalid) throw new Error('Fix the issue linking settings first.')
      if (customMissing) throw new Error('A custom pull request provider needs a URL template.')
      const config: RepoConfig = {
        issueLinking: issueRegex !== '' ? { issue: issueRegex, url: issueUrl } : null,
        pullRequest: pr,
        hideRemotes: hidden,
      }
      await request('repo.saveConfig', { config, repoPath })
      onChanged()
      onClose()
    })

  const exportConfig = () =>
    task(async () => {
      const { path } = await request('repo.exportConfig', { repoPath })
      setStatus({ kind: 'info', text: `Exported to ${path}` })
    })

  const userSection = (scope: 'local' | 'global') => (
    <div class="act-user" key={scope}>
      <div class="act-subhead">{scope === 'local' ? 'This repository' : 'Global'}</div>
      <Row label="Name">
        <TextInput value={users[scope].name} onInput={(v) => setUsers((u) => ({ ...u, [scope]: { ...u[scope], name: v } }))} />
      </Row>
      <Row label="Email">
        <TextInput value={users[scope].email} onInput={(v) => setUsers((u) => ({ ...u, [scope]: { ...u[scope], email: v } }))} />
      </Row>
      <div class="act-buttons">
        <button type="button" disabled={busy || users[scope].name.trim() === '' || users[scope].email.trim() === ''} onClick={() => setUser(scope)}>
          Set
        </button>
        <button
          type="button"
          disabled={busy || (data.user[scope].name === null && data.user[scope].email === null)}
          onClick={() => void runAction({ kind: 'user.unset', scope }, `${scope} user removed.`, false)}
        >
          Unset
        </button>
      </div>
    </div>
  )

  return (
    <Modal
      title="Repository Settings"
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <div class={`act-status ${status?.kind ?? ''}`}>{status?.text ?? ''}</div>
          <button type="button" disabled={busy} onClick={() => void exportConfig()}>
            Export…
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button type="button" class="primary" disabled={busy || issueInvalid || customMissing} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <section class="act-section">
        <div class="act-section-head">
          <h3>Remotes</h3>
          <div class="act-buttons">
            <button type="button" disabled={busy || remoteNames.length === 0} onClick={() => void runAction({ kind: 'remote.fetch', remote: null, prune: false, pruneTags: false }, 'Fetched all remotes.', true)}>
              Fetch all
            </button>
            <button type="button" disabled={busy} onClick={() => setRemoteDraft({ oldName: null, name: '', url: '', pushUrl: '', fetch: true })}>
              Add remote…
            </button>
          </div>
        </div>
        {data.remotes.length === 0 ? (
          <div class="act-message">No remotes configured.</div>
        ) : (
          <table class="act-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.remotes.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td class="act-url" title={r.pushUrl ? `push: ${r.pushUrl}` : undefined}>
                    {r.url ?? ''}
                    {r.pushUrl && r.pushUrl !== r.url ? <div class="act-hint">push: {r.pushUrl}</div> : null}
                  </td>
                  <td class="act-actions">
                    <button type="button" disabled={busy} onClick={() => setRemoteDraft({ oldName: r.name, name: r.name, url: r.url ?? '', pushUrl: r.pushUrl && r.pushUrl !== r.url ? r.pushUrl : '', fetch: false })}>
                      Edit
                    </button>
                    <button type="button" disabled={busy} onClick={() => void runAction({ kind: 'remote.fetch', remote: r.name, prune: false, pruneTags: false }, `Fetched ${r.name}.`, true)}>
                      Fetch
                    </button>
                    <button type="button" disabled={busy} onClick={() => void runAction({ kind: 'remote.prune', name: r.name }, `Pruned ${r.name}.`, true)}>
                      Prune
                    </button>
                    <button type="button" disabled={busy} onClick={() => deleteRemote(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {remoteDraft ? (
          <div class="act-subform">
            <div class="act-subhead">{remoteDraft.oldName === null ? 'Add remote' : `Edit "${remoteDraft.oldName}"`}</div>
            <Row label="Name">
              <TextInput value={remoteDraft.name} onInput={(v) => setRemoteDraft({ ...remoteDraft, name: v })} />
            </Row>
            <Row label="URL">
              <TextInput value={remoteDraft.url} onInput={(v) => setRemoteDraft({ ...remoteDraft, url: v })} />
            </Row>
            <Row label="Push URL">
              <TextInput value={remoteDraft.pushUrl} placeholder="Same as URL" onInput={(v) => setRemoteDraft({ ...remoteDraft, pushUrl: v })} />
            </Row>
            {remoteDraft.oldName === null ? (
              <label class="act-check">
                <input type="checkbox" checked={remoteDraft.fetch} onChange={(e) => setRemoteDraft({ ...remoteDraft, fetch: (e.target as HTMLInputElement).checked })} />
                <span>Fetch after adding</span>
              </label>
            ) : null}
            {draftError && (remoteDraft.name !== '' || remoteDraft.url !== '') ? <div class="act-error">{draftError}</div> : null}
            <div class="act-buttons">
              <button type="button" disabled={busy} onClick={() => setRemoteDraft(null)}>
                Cancel
              </button>
              <button type="button" class="primary" disabled={busy || draftError !== null} onClick={() => void saveRemote()}>
                {remoteDraft.oldName === null ? 'Add' : 'Update'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section class="act-section">
        <h3>User details</h3>
        <div class="act-hint">Used for commits. Setting local values overrides the global ones in this repository.</div>
        <div class="act-two-col">{userSection('local')}{userSection('global')}</div>
      </section>

      <section class="act-section">
        <h3>Issue linking</h3>
        <div class="act-hint">Text matching the regular expression becomes a link. Use $1…$9 for capture groups ($0 is the whole match).</div>
        <Row label="Issue regex">
          <TextInput value={issueRegex} placeholder="#(\d+)" onInput={setIssueRegex} />
        </Row>
        <Row label="URL">
          <TextInput value={issueUrl} placeholder="https://example.com/issues/$1" onInput={setIssueUrl} />
        </Row>
        <Row label="Try it">
          <TextInput value={issueSample} placeholder="Fixes #123" onInput={setIssueSample} />
        </Row>
        {issue.error ? <div class="act-error">{issue.error}</div> : null}
        {!issue.error && issueIncomplete ? <div class="act-error">Provide both a regex and a URL, or neither.</div> : null}
        {issueSample !== '' && issue.regex && !issue.error ? (
          <div class="act-preview">{issuePreview ? <>Links to: <code>{issuePreview}</code></> : 'No match.'}</div>
        ) : null}
      </section>

      <section class="act-section">
        <h3>Pull requests</h3>
        {pr === null ? (
          <div class="act-buttons">
            <button
              type="button"
              onClick={() => {
                const derived = defaultPullRequestConfig(data.remotes, graph.branches)
                setPr(
                  derived ?? {
                    provider: 'github',
                    hostRootUrl: 'https://github.com',
                    sourceOwner: '',
                    sourceRepo: '',
                    sourceRemote: remoteNames[0] ?? '',
                    destOwner: '',
                    destRepo: '',
                    destBranch: graph.branches.includes('main') ? 'main' : (graph.branches[0] ?? 'main'),
                    destRemote: remoteNames[0] ?? null,
                  }
                )
              }}
            >
              Configure pull requests
            </button>
          </div>
        ) : (
          <>
            <Row label="Provider">
              <select value={pr.provider} onChange={(e) => setPrField('provider', (e.target as HTMLSelectElement).value as PullRequestProvider)}>
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
            {pr.provider === 'custom' ? (
              <>
                <Row label="URL template">
                  <TextInput value={pr.customTemplate ?? ''} onInput={(v) => setPrField('customTemplate', v)} />
                </Row>
                <div class="act-hint">{CUSTOM_TEMPLATE_HELP}</div>
              </>
            ) : null}
            <Row label="Host URL">
              <TextInput value={pr.hostRootUrl} onInput={(v) => setPrField('hostRootUrl', v)} />
            </Row>
            <Row label="Source remote">
              <select value={pr.sourceRemote} onChange={(e) => setPrField('sourceRemote', (e.target as HTMLSelectElement).value)}>
                {!remoteNames.includes(pr.sourceRemote) ? <option value={pr.sourceRemote}>{pr.sourceRemote}</option> : null}
                {remoteNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Source owner">
              <TextInput value={pr.sourceOwner} onInput={(v) => setPrField('sourceOwner', v)} />
            </Row>
            <Row label="Source repo">
              <TextInput value={pr.sourceRepo} onInput={(v) => setPrField('sourceRepo', v)} />
            </Row>
            <Row label="Destination remote">
              <select value={pr.destRemote ?? ''} onChange={(e) => setPrField('destRemote', (e.target as HTMLSelectElement).value || null)}>
                <option value="">(none)</option>
                {remoteNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Destination owner">
              <TextInput value={pr.destOwner} onInput={(v) => setPrField('destOwner', v)} />
            </Row>
            <Row label="Destination repo">
              <TextInput value={pr.destRepo} onInput={(v) => setPrField('destRepo', v)} />
            </Row>
            <Row label="Destination branch">
              <TextInput value={pr.destBranch} onInput={(v) => setPrField('destBranch', v)} />
            </Row>
            {customMissing ? <div class="act-error">A custom provider needs a URL template.</div> : null}
            <div class="act-buttons">
              <button type="button" onClick={() => setPr(null)}>
                Remove configuration
              </button>
            </div>
          </>
        )}
      </section>

      <section class="act-section">
        <h3>Hidden remotes</h3>
        <div class="act-hint">Branches of checked remotes are not shown in the graph.</div>
        {remoteNames.length === 0 ? <div class="act-message">No remotes.</div> : null}
        {remoteNames.map((n) => (
          <label class="act-check" key={n}>
            <input
              type="checkbox"
              checked={hidden.includes(n)}
              onChange={(e) =>
                setHidden((cur) => ((e.target as HTMLInputElement).checked ? [...cur, n] : cur.filter((x) => x !== n)))
              }
            />
            <span>{n}</span>
          </label>
        ))}
      </section>
    </Modal>
  )
}
