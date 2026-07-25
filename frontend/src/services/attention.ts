/**
 * "Needs attention" heuristic for terminals.
 *
 * With several agents running, the hard question is not which ones are alive:
 * it is which one is waiting for you. A CLI agent that produced output and then
 * went quiet has either finished or is asking something, so a terminal counts as
 * waiting when it has spoken, stayed silent for a while, and has not been looked
 * at since that last output.
 */

export const ATTENTION_SILENCE_MS = 4000

export interface TerminalActivity {
  lastOutputAt: number
  seenAt: number
}

export const EMPTY_ACTIVITY: TerminalActivity = { lastOutputAt: 0, seenAt: 0 }

export function needsAttention(
  activity: TerminalActivity | undefined,
  now: number,
  silenceMs: number = ATTENTION_SILENCE_MS
): boolean {
  if (!activity || activity.lastOutputAt <= 0) return false
  if (activity.seenAt >= activity.lastOutputAt) return false
  return now - activity.lastOutputAt >= silenceMs
}

export function attentionIds(
  activity: Record<string, TerminalActivity>,
  ids: string[],
  now: number,
  silenceMs: number = ATTENTION_SILENCE_MS
): string[] {
  return ids.filter((id) => needsAttention(activity[id], now, silenceMs))
}
