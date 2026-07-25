import { getBackendBaseUrl, getBackendConnection } from './env'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500
const REQUEST_TIMEOUT_MS = 10_000

export function isRetryableMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

async function apiUrl(path: string): Promise<string> {
  const base = await getBackendBaseUrl()
  return `${base}/api${path}`
}

async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const mayRetry = isRetryableMethod(method)
  const connection = await getBackendConnection()
  const headers = new Headers(init?.headers)
  if (connection.apiToken) headers.set('Authorization', `Bearer ${connection.apiToken}`)
  const requestInit = { ...init, headers }
  let lastError: Error | undefined
  const attempts = mayRetry ? retries : 1
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const abortFromCaller = () => controller.abort()
    init?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    try {
      const res = await fetch(input, { ...requestInit, signal: controller.signal })
      if (mayRetry && [502, 503, 504].includes(res.status) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** i))
        continue
      }
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (init?.signal?.aborted) throw lastError
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** i))
      }
    } finally {
      window.clearTimeout(timeout)
      init?.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
  throw lastError ?? new Error('Network request failed')
}

export interface Agent {
  id: string
  name: string
  command: string
  args: string
  cwd: string
  cli_id?: string
  status: 'running' | 'stopped' | 'error'
  last_output_at?: number
  process_cwd_actual?: string
  cwd_drifted?: boolean
  git: GitStatus
}

export interface GitStatus {
  is_git?: boolean
  root?: string
  worktree_name?: string
  worktree_id?: string
  common_dir?: string
  repository_root?: string
  repository_name?: string
  repository_id?: string
  branch?: string
  head?: string
  detached?: boolean
  upstream?: string
  dirty?: boolean
  changed?: number
  staged?: number
  unstaged?: number
  untracked?: number
  ahead?: number
  behind?: number
  is_worktree?: boolean
  is_main_worktree?: boolean
  error?: string
  stale?: boolean
}

export interface GitCommit {
  sha: string
  short_sha: string
  author: string
  authored_at: string
  subject: string
  refs: string[]
}

export interface GitCommitList {
  worktree_id: string
  path: string
  commits: GitCommit[]
}

export interface GitChange {
  path: string
  code: string
  untracked: boolean
}

export interface GitChangeList {
  worktree_id: string
  path: string
  changes: GitChange[]
}

export interface WorktreeEntry {
  id: string
  path: string
  name: string
  head: string
  branch: string
  detached: boolean
  locked: boolean
  prunable: boolean
  is_main: boolean
  exists: boolean
  terminals: number
}

export interface RepositoryWorktrees {
  repository_id: string
  repository_name: string
  repository_root: string
  worktrees: WorktreeEntry[]
  error: string
}

export interface WorktreeInventory {
  repositories: RepositoryWorktrees[]
}

export interface OverlapFile {
  path: string
  worktree_ids: string[]
}

export interface OverlapWorktree {
  worktree_id: string
  name: string
  branch: string
  files: number
  agents: string[]
}

export interface RepositoryOverlap {
  repository_id: string
  repository_name: string
  base: string
  worktrees: OverlapWorktree[]
  conflicts: OverlapFile[]
  shared_checkouts: string[]
  error: string
}

export interface OverlapReport {
  repositories: RepositoryOverlap[]
  generated_at: number
}

export interface SessionAgent {
  id: string
  name: string
  command: string
  args: string
  cwd: string
  cli_id: string
}

export interface SessionSnapshot {
  agents: SessionAgent[]
  restorable: boolean
}

export interface RuntimeSettings {
  stt_provider: string
  cleaner_provider: string
  whisper_model_size: string
  whisper_language: string
  whisper_device: string
  whisper_compute_type: string
  whisper_beam_size: number
  preload_model: boolean
  scrollback_chars: number
}

export interface MergePreview {
  branch: string
  target: string
  ahead: number
  behind: number
  clean: boolean
  up_to_date: boolean
  conflicts: string[]
}

export interface Snapshot {
  tag: string
  sha: string
  created_at: string
  label: string
}

export interface SnapshotList {
  worktree_id: string
  path: string
  snapshots: Snapshot[]
}

export interface CreateAgentPayload {
  id: string
  name: string
  command: string
  args?: string
  cwd?: string
  autostart?: boolean
}

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetchWithRetry(await apiUrl('/agents'))
  if (!res.ok) throw new Error(`Server error ${res.status}`)
  return res.json()
}

export async function fetchGitCommits(
  worktreeId: string,
  limit = 50,
  signal?: AbortSignal
): Promise<GitCommitList> {
  const path = `/git/worktrees/${encodeURIComponent(worktreeId)}/commits?limit=${limit}`
  const res = await fetchWithRetry(await apiUrl(path), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to read Git history'))
  return res.json()
}

export async function createAgent(payload: CreateAgentPayload): Promise<Agent> {
  const res = await fetchWithRetry(await apiUrl('/agents'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to create agent: ${res.status} ${text}`)
  }
  return res.json()
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/agents/${id}`), {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`)
}

export async function deleteAllAgents(): Promise<number> {
  const res = await fetchWithRetry(await apiUrl('/agents'), {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Failed to delete all agents: ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return typeof data.count === 'number' ? data.count : 0
}

export async function startAgent(id: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/agents/${id}/start`), {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Failed to start agent: ${res.status}`)
}

export async function stopAgent(id: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/agents/${id}/stop`), {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Failed to stop agent: ${res.status}`)
}

export async function resizeAgent(id: string, cols: number, rows: number): Promise<void> {
  try {
    const res = await fetchWithRetry(await apiUrl(`/agents/${id}/resize`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    })
    if (!res.ok) throw new Error(`Failed to resize agent: ${res.status}`)
  } catch {
    // Non-fatal: resize is best-effort.
  }
}

export async function sendText(agentId: string, text: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/agents/${agentId}/send`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Failed to send text: ${res.status}`)
}

export async function setSttProvider(provider: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/audio/provider/${provider}`), { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to set STT provider: ${res.status}`)
}

export async function setCleanerProvider(provider: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/audio/cleaner/${provider}`), {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Failed to set cleaner provider: ${res.status}`)
}

export interface ProvidersInfo {
  stt: string[]
  cleaner: string[]
}

export async function fetchProviders(): Promise<ProvidersInfo> {
  const res = await fetchWithRetry(await apiUrl('/audio/providers'))
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.status}`)
  return res.json()
}

export interface CurrentProviders {
  stt_provider: string
  cleaner_provider: string
}

export interface SttStatus {
  state: 'not_loaded' | 'loading' | 'ready' | 'error'
  ready: boolean
  provider?: string
  model?: string
  device?: string
  compute_type?: string
  beam_size?: number
  warmup_seconds?: number
  warning?: string
  build_profile?: 'cpu' | 'cuda'
}

export async function fetchSttStatus(signal?: AbortSignal): Promise<SttStatus> {
  const res = await fetchWithRetry(await apiUrl('/audio/status'), { signal })
  if (!res.ok) throw new Error(`Failed to fetch STT status: ${res.status}`)
  return res.json()
}

export async function fetchCurrentProviders(): Promise<CurrentProviders> {
  const res = await fetchWithRetry(await apiUrl('/audio/current'))
  if (!res.ok) throw new Error(`Failed to fetch current providers: ${res.status}`)
  return res.json()
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(await apiUrl('/health'), { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

export interface CliInfo {
  id: string
  name: string
  commands: string[]
  install_url: string
  kind: string
  installed: boolean
  path: string
  runtime: 'native' | 'wsl'
  version: string
  diagnostic: string
  custom: boolean
  default_args: string
}

export async function fetchClis(signal?: AbortSignal): Promise<CliInfo[]> {
  const res = await fetchWithRetry(await apiUrl('/clis'), { signal })
  if (!res.ok) throw new Error(`Failed to scan CLIs: ${res.status}`)
  return res.json()
}

export async function saveCustomCli(payload: {
  id: string
  name: string
  executable: string
  args?: string
}): Promise<CliInfo> {
  const res = await fetchWithRetry(await apiUrl('/clis/custom'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to save CLI'))
  return res.json()
}

export async function deleteCustomCli(id: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl(`/clis/custom/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to delete CLI'))
}

export interface WorkspaceWorkerPayload {
  name: string
  role: string
  cli_id: string
  args?: string
  cwd?: string
  use_worktree?: boolean
  branch?: string
  destination?: string
}

export async function launchWorkspace(payload: {
  repository?: string
  base_ref?: string
  workers: WorkspaceWorkerPayload[]
  copy_ignored?: string[]
}): Promise<{ status: string; agents: Array<Record<string, unknown>> }> {
  const res = await fetchWithRetry(await apiUrl('/workspaces/launch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to launch workspace'))
  return res.json()
}

export async function fetchGitChanges(
  worktreeId: string,
  signal?: AbortSignal
): Promise<GitChangeList> {
  const path = `/git/worktrees/${encodeURIComponent(worktreeId)}/changes`
  const res = await fetchWithRetry(await apiUrl(path), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to read Git changes'))
  return res.json()
}

export async function fetchWorktreeInventory(signal?: AbortSignal): Promise<WorktreeInventory> {
  const res = await fetchWithRetry(await apiUrl('/git/worktrees'), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to list worktrees'))
  return res.json()
}

export async function fetchOverlaps(
  refresh = false,
  signal?: AbortSignal
): Promise<OverlapReport> {
  const res = await fetchWithRetry(await apiUrl(`/git/overlaps?refresh=${refresh}`), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to compare worktrees'))
  return res.json()
}

export async function fetchPreviousSession(signal?: AbortSignal): Promise<SessionSnapshot> {
  const res = await fetchWithRetry(await apiUrl('/session'), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to read the previous session'))
  return res.json()
}

export async function restoreSession(): Promise<{
  restored: string[]
  skipped: Array<{ id: string; reason: string }>
}> {
  const res = await fetchWithRetry(await apiUrl('/session/restore'), { method: 'POST' })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to restore the session'))
  return res.json()
}

export async function forgetSession(): Promise<void> {
  const res = await fetchWithRetry(await apiUrl('/session'), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to forget the session'))
}

export async function fetchRuntimeSettings(signal?: AbortSignal): Promise<RuntimeSettings> {
  const res = await fetchWithRetry(await apiUrl('/settings/runtime'), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to read voice settings'))
  return res.json()
}

export async function saveRuntimeSettings(
  patch: Partial<RuntimeSettings>
): Promise<RuntimeSettings> {
  const res = await fetchWithRetry(await apiUrl('/settings/runtime'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to save voice settings'))
  return res.json()
}

export async function fetchMergePreview(
  worktreeId: string,
  signal?: AbortSignal
): Promise<MergePreview> {
  const path = `/integration/preview?worktree_id=${encodeURIComponent(worktreeId)}`
  const res = await fetchWithRetry(await apiUrl(path), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to preview the merge'))
  return res.json()
}

export async function integrateBranch(
  worktreeId: string,
  mode: 'merge' | 'cherry-pick'
): Promise<{ status: string; branch: string; target: string; output: string }> {
  const res = await fetchWithRetry(await apiUrl('/integration/integrate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktree_id: worktreeId, mode }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to integrate the branch'))
  return res.json()
}

export async function openPullRequest(
  worktreeId: string,
  title: string,
  body: string
): Promise<{ status: string; url: string }> {
  const res = await fetchWithRetry(await apiUrl('/integration/pull-request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktree_id: worktreeId, title, body }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to open the pull request'))
  return res.json()
}

export async function fetchSnapshots(
  worktreeId: string,
  signal?: AbortSignal
): Promise<SnapshotList> {
  const path = `/integration/snapshots?worktree_id=${encodeURIComponent(worktreeId)}`
  const res = await fetchWithRetry(await apiUrl(path), { signal })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to read restore points'))
  return res.json()
}

export async function createSnapshot(worktreeId: string, label: string): Promise<Snapshot> {
  const res = await fetchWithRetry(await apiUrl('/integration/snapshots'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktree_id: worktreeId, label }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to create the restore point'))
  return res.json()
}

export async function restoreSnapshot(worktreeId: string, tag: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl('/integration/snapshots/restore'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktree_id: worktreeId, tag }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to restore'))
}

export async function deleteSnapshot(worktreeId: string, tag: string): Promise<void> {
  const res = await fetchWithRetry(await apiUrl('/integration/snapshots/delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktree_id: worktreeId, tag }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to delete the restore point'))
}

export async function removeWorktree(path: string, deleteBranch = false): Promise<void> {
  const res = await fetchWithRetry(await apiUrl('/workspaces/worktrees/remove'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, delete_branch: deleteBranch }),
  })
  if (!res.ok) throw new Error(await readableApiError(res, 'Failed to remove worktree'))
}

async function readableApiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { detail?: string } | null
  return data?.detail || `${fallback}: ${res.status}`
}
