export type DictationMode = 'terminal' | 'global'
export type GlobalDictationTarget = 'terminal' | 'external'

export type DictationDelivery =
  | { kind: 'terminal'; agentId: string }
  | { kind: 'external' }
  | { kind: 'unavailable' }

export function resolveDictationDelivery(
  mode: DictationMode,
  globalTarget: GlobalDictationTarget,
  selectedAgent: string | null
): DictationDelivery {
  if (mode === 'global' && globalTarget === 'external') {
    return { kind: 'external' }
  }
  if (!selectedAgent) {
    return { kind: 'unavailable' }
  }
  return { kind: 'terminal', agentId: selectedAgent }
}
