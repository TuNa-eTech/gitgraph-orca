import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ActionResult, GitAction, GraphData } from '../../shared/protocol'
import { ContextMenu } from './actions/ContextMenu'
import { Dialog, type DialogSpec } from './actions/Dialog'
import { buildMenu, type MenuContext, type MenuTarget } from './actions/menus'
import { buildPullRequestUrl } from './actions/pullRequest'
import { RepoSettingsDialog } from './actions/RepoSettings'
import { request } from '../request'

export type { MenuTarget } from './actions/menus'

// ---------- Module-level store ----------

type Toast = { id: number; kind: 'info' | 'error'; text: string }

type StoreState = {
  menu: { x: number; y: number; target: MenuTarget } | null
  settingsOpen: boolean
  toast: Toast | null
}

let state: StoreState = { menu: null, settingsOpen: false, toast: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function useStore(): StoreState {
  const [, force] = useState(0)
  useEffect(() => subscribe(() => force((n) => n + 1)), [])
  return state
}

export function openContextMenu(e: MouseEvent, target: MenuTarget): void {
  e.preventDefault()
  e.stopPropagation()
  setState({ menu: { x: e.clientX, y: e.clientY, target } })
}

export function openRepoSettings(): void {
  setState({ settingsOpen: true })
}

let toastSeq = 0
let toastTimer: number | undefined

function showToast(kind: Toast['kind'], text: string): void {
  clearTimeout(toastTimer)
  const id = ++toastSeq
  setState({ toast: { id, kind, text } })
  toastTimer = window.setTimeout(() => {
    if (state.toast?.id === id) setState({ toast: null })
  }, kind === 'error' ? 8000 : 2500)
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ---------- Host ----------

export function ActionsHost(props: { graph: GraphData; repoPath?: string; onDone(): void }) {
  const { graph, repoPath } = props
  const { menu, settingsOpen, toast } = useStore()
  const [dialog, setDialog] = useState<{ id: number; spec: DialogSpec } | null>(null)
  const dialogSeq = useRef(0)

  // The handlers live across renders; read the latest props through a ref.
  const latest = useRef(props)
  latest.current = props

  const ctx = useMemo<MenuContext>(() => {
    const open = (spec: DialogSpec) => setDialog({ id: ++dialogSeq.current, spec })
    const close = () => setDialog(null)

    const showError = (title: string, message: string) =>
      open({ title, preformatted: message, primary: { label: 'Close' }, cancelLabel: null, onSubmit: close })

    const handleResult = (result: ActionResult, action: GitAction): boolean => {
      if (result.status === 'ok') return true
      if (result.status === 'error') {
        showError('Git Command Failed', result.message)
        return false
      }
      open({
        title: 'Authentication Required',
        message: 'Git needs credentials that cannot be entered here. Run the command in a terminal to continue.',
        preformatted: result.message,
        primary: { label: 'Run in Terminal' },
        onSubmit: async () => {
          try {
            await request('action.runInTerminal', { command: result.command, repoPath: latest.current.repoPath })
            close()
            showToast('info', `Started in a terminal: ${action.kind}`)
          } catch (error) {
            showError('Could Not Open Terminal', messageOf(error))
          }
        },
      })
      return false
    }

    const run = async (action: GitAction) => {
      try {
        const result = await request('action.run', { action, repoPath: latest.current.repoPath })
        if (handleResult(result, action)) {
          close()
          latest.current.onDone()
        }
      } catch (error) {
        showError('Git Command Failed', messageOf(error))
      }
    }

    const copy = (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => showToast('info', 'Copied to clipboard'),
        () =>
          open({
            title: 'Copy',
            message: 'Clipboard access is unavailable. Select the text below and copy it manually.',
            preformatted: text,
            primary: { label: 'Close' },
            cancelLabel: null,
            onSubmit: close,
          })
      )
    }

    const createPullRequest = async (branch: string) => {
      try {
        const settings = await request('repo.settings', { repoPath: latest.current.repoPath })
        const config = settings.config.pullRequest
        if (!config) {
          open({
            title: 'Pull Request Not Configured',
            message: 'Choose a provider and the source and destination repositories in Repository Settings first.',
            primary: { label: 'Open Repository Settings' },
            onSubmit: () => {
              close()
              openRepoSettings()
            },
          })
          return
        }
        const url = buildPullRequestUrl(config, branch)
        if (!orca.shell) {
          open({ title: 'Pull Request URL', message: 'Opening links is unavailable here. Copy the URL instead.', preformatted: url, primary: { label: 'Copy' }, onSubmit: () => (copy(url), close()) })
          return
        }
        const result = await orca.shell.openExternal(url)
        if (!result.opened && result.reason !== 'cancelled') showToast('error', 'Could not open the browser.')
      } catch (error) {
        showError('Create Pull Request Failed', messageOf(error))
      }
    }

    const viewTag = async (name: string) => {
      try {
        const d = await request('tag.details', { name, repoPath: latest.current.repoPath })
        const when = new Date(d.time * 1000).toLocaleString()
        open({
          title: `Tag ${d.name}`,
          preformatted: `Object: ${d.hash}\nTagger: ${d.tagger} <${d.email}>\nDate:   ${when}\n\n${d.message}`,
          primary: { label: 'Close' },
          cancelLabel: null,
          onSubmit: close,
        })
      } catch (error) {
        showError('Tag Details Failed', messageOf(error))
      }
    }

    const archive = async (ref: string, format: 'zip' | 'tar') => {
      if (!orca.files) {
        showError('Download Archive', 'Saving files is not available in this environment.')
        return
      }
      showToast('info', 'Creating archive…')
      try {
        const { base64, name } = await request('commit.archive', { ref, format, repoPath: latest.current.repoPath })
        const result = await orca.files.saveAs({
          suggestedName: name,
          mimeType: format === 'zip' ? 'application/zip' : 'application/x-tar',
          data: base64ToBuffer(base64),
        })
        showToast('info', result.status === 'saved' ? 'Archive saved' : 'Cancelled')
      } catch (error) {
        showError('Download Archive Failed', messageOf(error))
      }
    }

    return {
      get graph() {
        return latest.current.graph
      },
      run,
      open,
      close,
      copy,
      createPullRequest: (b) => void createPullRequest(b),
      viewTag: (n) => void viewTag(n),
      archive: (r, f) => void archive(r, f),
    }
  }, [])

  const items = useMemo(() => (menu ? buildMenu(ctx, menu.target) : []), [menu, ctx, graph])
  const closeMenu = () => setState({ menu: null })

  // Settings runs actions itself so it can show results inline.
  const runForSettings = async (action: GitAction): Promise<ActionResult> => {
    try {
      return await request('action.run', { action, repoPath })
    } catch (error) {
      return { status: 'error', message: messageOf(error) }
    }
  }

  return (
    <>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} /> : null}
      {dialog ? <Dialog key={dialog.id} spec={dialog.spec} onClose={() => setDialog(null)} /> : null}
      {settingsOpen ? (
        <RepoSettingsDialog
          repoPath={repoPath}
          graph={graph}
          run={runForSettings}
          onClose={() => setState({ settingsOpen: false })}
          onChanged={props.onDone}
        />
      ) : null}
      {toast ? (
        <div class={`act-toast ${toast.kind}`} role="status" key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </>
  )
}
