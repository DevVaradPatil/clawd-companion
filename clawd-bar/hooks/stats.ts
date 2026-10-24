// Today's tally for /clawd stats. Each session keeps what happened since its last save (a delta) and adds it
// to the day's record in $.store, so several sessions open at once sum instead of overwriting. Pure: runs under node.

import { span } from './hud.ts'

export type Day = {
  date: string // the local day, YYYY-MM-DD
  turns: number
  workMs: number // time Claude spent working on turns
  longestMs: number
  waitMs: number // time Claude spent waiting on the person (dialogs and quiet waits)
  errors: number
  compacts: number
  tools: Record<string, number> // calls by kind of work (Mood)
}

export const today = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const emptyDay = (date: string): Day => ({ date, turns: 0, workMs: 0, longestMs: 0, waitMs: 0, errors: 0, compacts: 0, tools: {} })

// the stored day plus this session's unsaved delta; a stored day from another date starts over
export const merge = (stored: Day | undefined, delta: Day): Day => {
  const base = stored && stored.date === delta.date ? stored : emptyDay(delta.date)
  const tools = { ...base.tools }
  for (const [k, n] of Object.entries(delta.tools)) tools[k] = (tools[k] ?? 0) + n
  return {
    date: delta.date,
    turns: base.turns + delta.turns,
    workMs: base.workMs + delta.workMs,
    longestMs: Math.max(base.longestMs, delta.longestMs),
    waitMs: base.waitMs + delta.waitMs,
    errors: base.errors + delta.errors,
    compacts: base.compacts + delta.compacts,
    tools,
  }
}

const NAMES: Record<string, string> = {
  edit: 'edits', read: 'reads', search: 'searches', bash: 'commands', test: 'test runs', git: 'git', build: 'builds',
  clean: 'cleanups', server: 'server', web: 'web', agent: 'subagents', mcp: 'MCP', plan: 'planning', ask: 'questions',
  skill: 'skills', secure: 'secrets', settings: 'settings', think: 'other', long: 'other',
}

export const format = (d: Day, ctx: string | null): string => {
  const calls = Object.values(d.tools).reduce((a, b) => a + b, 0)
  const byKind = new Map<string, number>()
  for (const [k, n] of Object.entries(d.tools)) byKind.set(NAMES[k] ?? k, (byKind.get(NAMES[k] ?? k) ?? 0) + n)
  const top = [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(' · ')
  return [
    `Today with Claude, all sessions (${d.date})`,
    `  ${d.turns} turn${d.turns === 1 ? '' : 's'} · ${span(d.workMs)} of work · longest ${span(d.longestMs)}`,
    `  ${calls} tool call${calls === 1 ? '' : 's'}${top ? `: ${top}` : ''}`,
    `  Waited on you: ${span(d.waitMs)}`,
    `  Errors: ${d.errors} · Compactions: ${d.compacts}`,
    ...(ctx ? [`  Context now: ${ctx}`] : []),
  ].join('\n')
}
