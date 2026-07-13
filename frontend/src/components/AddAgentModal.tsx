import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  deleteCustomCli,
  fetchClis,
  launchWorkspace,
  saveCustomCli,
  type CliInfo,
  type WorkspaceWorkerPayload,
} from '../services/api'
import Icon from './Icon'

interface Props {
  onClose: () => void
  onCreated: () => void
}

type Mode = 'terminal' | 'parallel' | 'clis'

interface WorkerDraft {
  name: string
  role: string
  cliId: string
  cwd: string
  args: string
  useWorktree: boolean
}

const worker = (index: number, cliId: string): WorkerDraft => ({
  name: `Worker ${index + 1}`,
  role: ['coordinator', 'backend', 'frontend', 'tests'][index] ?? `task-${index + 1}`,
  cliId,
  cwd: '',
  args: '',
  useWorktree: index > 0,
})

export default function AddAgentModal({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('terminal')
  const [clis, setClis] = useState<CliInfo[]>([])
  const [scanning, setScanning] = useState(true)
  const [selectedCli, setSelectedCli] = useState('kimi')
  const [count, setCount] = useState(1)
  const [args, setArgs] = useState('')
  const [cwd, setCwd] = useState('')
  const [repository, setRepository] = useState('')
  const [baseRef, setBaseRef] = useState('main')
  const [workers, setWorkers] = useState<WorkerDraft[]>([])
  const [custom, setCustom] = useState({ id: '', name: '', executable: '', args: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const installed = useMemo(() => clis.filter((cli) => cli.installed), [clis])
  const activeCli = clis.find((cli) => cli.id === selectedCli)

  const scan = async (signal?: AbortSignal) => {
    setScanning(true)
    setError(null)
    try {
      const found = await fetchClis(signal)
      setClis(found)
      const preferred = found.find((cli) => cli.id === selectedCli && cli.installed) ?? found.find((cli) => cli.installed)
      if (preferred) setSelectedCli(preferred.id)
      setWorkers((current) => current.length ? current : [0, 1, 2, 3].map((i) => worker(i, preferred?.id ?? '')))
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(message(err))
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void scan(controller.signal)
    return () => controller.abort()
  }, [])

  const pickFolder = async (setter: (path: string) => void) => {
    const picked = await window.electronAPI?.selectFolder?.()
    if (picked) setter(picked)
  }

  const launchTerminal = async () => {
    if (!activeCli?.installed) throw new Error('Select an installed CLI')
    await launchWorkspace({
      workers: Array.from({ length: count }, (_, index) => ({
        name: `${activeCli.name}${count > 1 ? ` ${index + 1}` : ''}`,
        role: 'terminal',
        cli_id: activeCli.id,
        cwd: cwd.trim(),
        args,
      })),
    })
  }

  const launchParallel = async () => {
    const payloadWorkers: WorkspaceWorkerPayload[] = workers.map((item) => ({
      name: item.name,
      role: item.role,
      cli_id: item.cliId,
      args: item.args,
      cwd: item.cwd,
      use_worktree: item.useWorktree,
    }))
    await launchWorkspace({ repository: repository.trim(), base_ref: baseRef.trim(), workers: payloadWorkers })
  }

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      if (mode === 'terminal') await launchTerminal()
      else if (mode === 'parallel') await launchParallel()
      onCreated()
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setLoading(false)
    }
  }

  const addCustom = async () => {
    setLoading(true)
    setError(null)
    try {
      await saveCustomCli(custom)
      setCustom({ id: '', name: '', executable: '', args: '' })
      await scan()
    } catch (err) {
      setError(message(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel workspace-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><h2>Open workspace</h2><p className="muted-copy">Launch one terminal, parallel projects, or isolated Git worktrees.</p></div>
          <button className="icon-button close-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="workspace-tabs" role="tablist">
          {([['terminal', 'Terminal'], ['parallel', 'Parallel workspace'], ['clis', 'CLI manager']] as const).map(([id, label]) => (
            <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)} role="tab">{label}</button>
          ))}
        </div>

        {error && <div className="error-banner workspace-error"><Icon name="alertCircle" />{error}</div>}

        {mode === 'terminal' && (
          <div className="form-stack">
            <CliPicker clis={clis} selected={selectedCli} onSelect={setSelectedCli} scanning={scanning} />
            <FolderField label="Working folder" value={cwd} onChange={setCwd} onBrowse={() => pickFolder(setCwd)} />
            <div className="field"><label>Arguments (optional)</label><input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--model ..." /></div>
            <div className="field"><label>Number of terminals</label><select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 6, 8, 9].map((n) => <option key={n} value={n}>{n}{n === 4 ? ' (2×2)' : ''}</option>)}</select></div>
          </div>
        )}

        {mode === 'parallel' && (
          <div className="form-stack">
            <div className="parallel-intro"><strong>Safe same-repository mode</strong><span>Workers using worktrees receive an isolated branch. The first coordinator stays in the main checkout.</span></div>
            <FolderField label="Git repository (required for worktrees)" value={repository} onChange={setRepository} onBrowse={() => pickFolder(setRepository)} />
            <div className="field"><label>Base ref</label><input value={baseRef} onChange={(e) => setBaseRef(e.target.value)} placeholder="main" /></div>
            <div className="worker-list">
              {workers.map((item, index) => (
                <div className="worker-row" key={index}>
                  <span className="worker-number">{index + 1}</span>
                  <input aria-label={`Worker ${index + 1} name`} value={item.name} onChange={(e) => updateWorker(setWorkers, index, { name: e.target.value })} />
                  <input aria-label={`Worker ${index + 1} role`} value={item.role} onChange={(e) => updateWorker(setWorkers, index, { role: e.target.value })} />
                  <select aria-label={`Worker ${index + 1} CLI`} value={item.cliId} onChange={(e) => updateWorker(setWorkers, index, { cliId: e.target.value })}>
                    {installed.map((cli) => <option key={cli.id} value={cli.id}>{cli.name}{cli.runtime === 'wsl' ? ' (WSL)' : ''}</option>)}
                  </select>
                  <label className="worktree-check"><input type="checkbox" checked={item.useWorktree} onChange={(e) => updateWorker(setWorkers, index, { useWorktree: e.target.checked })} /> Worktree</label>
                  <button className="icon-button" disabled={workers.length === 1} onClick={() => setWorkers((all) => all.filter((_, i) => i !== index))} aria-label={`Remove worker ${index + 1}`}><Icon name="close" /></button>
                  <div className="worker-options">
                    <div className="inline-field">
                      <input aria-label={`Worker ${index + 1} folder`} disabled={item.useWorktree} value={item.cwd} onChange={(e) => updateWorker(setWorkers, index, { cwd: e.target.value })} placeholder={item.useWorktree ? 'Created automatically from repository' : 'Project folder (repository when blank)'} />
                      <button disabled={item.useWorktree} onClick={() => pickFolder((path) => updateWorker(setWorkers, index, { cwd: path }))}><Icon name="folder" /> Browse</button>
                    </div>
                    <input aria-label={`Worker ${index + 1} arguments`} value={item.args} onChange={(e) => updateWorker(setWorkers, index, { args: e.target.value })} placeholder="CLI arguments (optional)" />
                  </div>
                </div>
              ))}
            </div>
            {workers.length < 9 && <button onClick={() => setWorkers((all) => [...all, worker(all.length, installed[0]?.id ?? '')])}><Icon name="plus" /> Add worker</button>}
          </div>
        )}

        {mode === 'clis' && (
          <div className="cli-manager">
            <div className="cli-manager-toolbar"><p>{installed.length} of {clis.length} CLIs detected</p><button onClick={() => void scan()} disabled={scanning}>{scanning ? 'Scanning…' : 'Rescan'}</button></div>
            <div className="cli-diagnostics">
              {clis.map((cli) => (
                <div className={`cli-diagnostic ${cli.installed ? 'installed' : ''}`} key={cli.id}>
                  <span className="cli-state">{cli.installed ? '✓' : '—'}</span>
                  <div><strong>{cli.name}</strong><small>{cli.installed ? `${cli.runtime.toUpperCase()} · ${cli.version || cli.path}` : 'Not found'}{cli.kind === 'general-assistant' ? ' · general assistant' : ''}</small></div>
                  {cli.install_url && <a href={cli.install_url} target="_blank" rel="noreferrer">Official docs</a>}
                  {cli.custom && <button className="danger-link" onClick={async () => { await deleteCustomCli(cli.id); await scan() }}>Remove</button>}
                </div>
              ))}
            </div>
            <div className="custom-cli-form">
              <h3>Add local executable</h3>
              <div className="custom-cli-grid">
                <input placeholder="id (my-cli)" value={custom.id} onChange={(e) => setCustom({ ...custom, id: e.target.value })} />
                <input placeholder="Display name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                <div className="inline-field"><input placeholder="Executable path" value={custom.executable} onChange={(e) => setCustom({ ...custom, executable: e.target.value })} /><button onClick={async () => { const path = await window.electronAPI?.selectExecutable?.(); if (path) setCustom({ ...custom, executable: path }) }}>Browse</button></div>
                <input placeholder="Default arguments (optional)" value={custom.args} onChange={(e) => setCustom({ ...custom, args: e.target.value })} />
              </div>
              <button className="btn-primary" disabled={loading || !custom.id || !custom.name || !custom.executable} onClick={addCustom}>Save and verify</button>
            </div>
          </div>
        )}

        <div className="modal-footer align-end">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          {mode !== 'clis' && <button className="btn-primary" onClick={submit} disabled={loading || scanning || (mode === 'parallel' && workers.some((item) => !item.cliId))}><Icon name="plus" />{loading ? 'Launching…' : mode === 'parallel' ? `Launch ${workers.length} workers` : 'Open'}</button>}
        </div>
      </div>
    </div>
  )
}

function CliPicker({ clis, selected, onSelect, scanning }: { clis: CliInfo[]; selected: string; onSelect: (id: string) => void; scanning: boolean }) {
  return <div className="field"><label>CLI {scanning && <span className="loading-dot">scanning</span>}</label><div className="preset-grid">{clis.map((cli) => <button key={cli.id} disabled={!cli.installed} className={`preset-chip${selected === cli.id ? ' active' : ''}${!cli.installed ? ' unavailable' : ''}`} onClick={() => onSelect(cli.id)} title={cli.installed ? cli.path : 'Not installed'}><Icon name="terminal" className="preset-icon" />{cli.name}<span className="cli-dot">{cli.installed ? '●' : '○'}</span></button>)}</div></div>
}

function FolderField({ label, value, onChange, onBrowse }: { label: string; value: string; onChange: (value: string) => void; onBrowse: () => void }) {
  return <div className="field"><label>{label}</label><div className="inline-field"><input value={value} onChange={(e) => onChange(e.target.value)} placeholder="D:\projects\my-app" /><button onClick={onBrowse}><Icon name="folder" /> Browse</button></div></div>
}

function updateWorker(setter: Dispatch<SetStateAction<WorkerDraft[]>>, index: number, patch: Partial<WorkerDraft>) {
  setter((all) => all.map((item, i) => i === index ? { ...item, ...patch } : item))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
