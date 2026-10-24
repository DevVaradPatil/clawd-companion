import type { Hook, Register } from 'claude-code'
import { WALK_FROM, compilePack, type Pack } from './compile.ts'
import { CUES, HOBBY_LINES, IDLE_LINES, PACK_NAMES, SAY, WALK_LINES, WORK, answerNeed, classify, pollNeed, type Cue, type Mood } from './poses.ts'
import { DANGER, WARN, burnOf, hud, k, span, type Info, type Sample } from './hud.ts'
import { emptyDay, format, merge, today, type Day } from './stats.ts'
import { at, busyMs, hasPack, pick, plan, react, render, setScale, stageH, usePack, type Mode, type Motion, type Seg } from './stage.ts'

// clawd-bar: one bar above the prompt, drawn as ONE in-flow SVG: context, usage limits and the turn clock
// behind, Claude's pixel mascot roaming in front, posing for whatever tool is running. Clicks and hovers on the
// mascot are SMIL inside the SVG (no round trip). The art is the person's own download of the Claude Mascot
// Pack, compiled here at startup and cached. Never name a local `h`: JSX compiles to h(...).

type Api = Parameters<Hook<'turn.start'>>[0]

const CELL_PX = 8 // the desktop's cell width in CSS px (measured for pika-bar: 94 columns = 752px)
const SLEEPY_AFTER_MS = 10 * 60_000
const ERROR_COOLDOWN_MS = 5_000
const RESTAGE_MS = 6_000 // the same mood keeps its scene at least this long between tool calls
const LONG_TURN_MS = 3 * 60_000
const LONG_JOB_MS = 10 * 60_000 // a turn this long finishes with a bigger celebration
const WAIT_SHOW_MS = 400 // a dialog answered quicker than this never shows as waiting
const REPAINT_MS = 1_500 // the hover line follows the newest tool at most this often
const SIZES = [1, 1.5, 2]
const PACK_URL = 'https://getillustrations.com/illustration-pack/claude-mascot-pack'
const rng = Math.random

// ---------- settings, kept across sessions in $.store ----------
type Settings = { on: boolean; compact: boolean; size: number; motion: Motion; sound: boolean }
let settings: Settings = { on: true, compact: false, size: 1, motion: 'on', sound: false }
const MOTIONS: Motion[] = ['on', 'auto', 'off']
const saveSettings = ($: Api) => $.store.set('settings', settings)

// ---------- the mascot ----------
let stagePx = 0
let scene: Seg[] = []
let sceneAt = 0
let svg = ''
let mode: Mode = 'idle'
let mood: Mood = 'think'
let doing = 'taking it easy' // the hover line
let stagedAt = 0
let lastError = 0
let nextScene: { cancel: () => void } | null = null
let sleepy: { cancel: () => void } | null = null
let click = { pose: CUES.click[0]!, say: 'hi!' }
let helloPending = false // the session started before the bar had a width
let packNote = '' // what loading the art came to, for /clawd

// ---------- the info behind it ----------
let info: Info = { ctx: null, limits: [], burn: null, working: false, waiting: false, nudge: null, turnAt: 0, endAt: null, lastMs: null, flash: null }
let ticker: { cancel: () => void } | null = null
let samples: Sample[] = [] // the 5-hour window's readings, for its pace
let windowSeen = '' // which 5-hour window those readings belong to (its reset time)
let agents = 0 // subagents running now
let ctxBefore: number | null = null // the context's tokens when the turn began
let waitTimer: { cancel: () => void } | null = null
let waitingFor: string | null = null // the tool call a dialog is holding up
const inFlight = new Map<string, string>() // running tool calls: tool_use_id -> tool name
let lastLabel = 'thinking' // what Claude did last, for the hover once a wait ends
let repaintTimer: { cancel: () => void } | null = null
let nudgeTimer: { cancel: () => void } | null = null
let nudgeToasted = '' // the quiet wait already announced with a toast
let delta: Day = emptyDay(today(Date.now())) // this session's tally since its last save to the day's record
let waitSince: number | null = null // when Claude started waiting on the person, for the tally

const work = () => (mode === 'sleepy' ? CUES.sleep : mode === 'busy' ? WORK[mood] : CUES.hobby)

// ---------- the art: the person's copy of the pack, found, compiled, cached ----------
type SvgFile = { name: string; path: string; size: number; mtimeMs: number }
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`

const svgsIn = async ($: Api, dir: string, depth = 4): Promise<SvgFile[]> => {
  const entries = await $.fs.list(dir).catch(() => [])
  const here = entries.filter(e => e.kind === 'file' && e.name.toLowerCase().endsWith('.svg'))
    .map(e => ({ name: e.name.slice(0, -4), path: join(dir, e.name), size: e.size, mtimeMs: e.mtimeMs }))
  if (depth <= 0) return here
  const below = await Promise.all(entries.filter(e => e.kind === 'dir').map(e => svgsIn($, join(dir, e.name), depth - 1)))
  return [...here, ...below.flat()]
}

// An unzipped pack in the working folder, or in Downloads, Desktop or Documents in a folder whose name says so.
const discover = async ($: Api): Promise<string | null> => {
  if ((await svgsIn($, '.', 2)).some(f => f.name === WALK_FROM)) return (await $.fs.stat('.', { resolve: true })).realPath ?? null
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return null
  for (const place of ['Downloads', 'Desktop', 'Documents']) {
    const root = join(home, place)
    for (const e of await $.fs.list(root).catch(() => [])) {
      if (e.kind !== 'dir' || !/claude|mascot|clawd/i.test(e.name)) continue
      const dir = join(root, e.name)
      if ((await svgsIn($, dir, 3)).some(f => f.name === WALK_FROM)) return dir
    }
  }
  return null
}

// Loads the art from `dir` (else the saved folder, else one it finds). Answers what happened, in a sentence.
const loadPack = async ($: Api, dir?: string): Promise<string> => {
  const from = dir ?? ((await $.store.get('packDir')) as string | undefined) ?? (await discover($))
  if (!from) return `No mascot art yet. Download the free Claude Mascot Pack (${PACK_URL}), unzip it, then /clawd pack <folder>.`
  const found = new Map<string, SvgFile>()
  for (const f of await svgsIn($, from)) if (!found.has(f.name)) found.set(f.name, f)
  if (!found.has(WALK_FROM)) return `No Claude Mascot Pack SVGs in ${from}. Point /clawd pack at the unzipped pack (${PACK_URL}).`
  const files = [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
  const sig = files.map(f => `${f.name}:${f.size}:${f.mtimeMs}`).join('|')
  const cached = (await $.store.get('packCache')) as { dir: string; sig: string; pack: Pack } | undefined
  let pack: Pack
  if (cached && cached.dir === from && cached.sig === sig) pack = cached.pack
  else {
    const texts = await Promise.all(files.map(async f => ({ name: f.name, svg: (await $.fs.read(f.path)) as string })))
    pack = compilePack(texts).pack
    await $.store.set('packCache', { dir: from, sig, pack })
  }
  await $.store.set('packDir', from)
  usePack(pack)
  setScale(settings.size)
  const missing = PACK_NAMES.filter(n => !pack.sprites[n])
  return `Clawd's art: ${Object.keys(pack.sprites).length} poses from ${from}` + (missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 3).join(', ')}…; those moments fall back to walking)` : '')
}

// ---------- the info ----------
const refresh = async ($: Api, breakdown = false) => {
  try {
    const u = await $.session.usage(breakdown ? { breakdown: 'summary' } : undefined)
    const b = u.context.breakdown
    info = {
      ...info,
      ctx: {
        pct: Math.round(u.context.percent ?? b?.percentage ?? 0),
        tokens: u.context.tokens ?? b?.totalTokens ?? 0,
        window: u.context.window,
        cats: b ? b.categories.filter(c => c.kind === 'used').map(c => ({ name: c.name, tokens: c.tokens })) : info.ctx?.cats ?? [],
        max: b?.rawMaxTokens ?? info.ctx?.max ?? u.context.window,
        ...(b ? (b.isAutoCompactEnabled && b.autoCompactThreshold ? { compactAt: b.autoCompactThreshold } : {}) : info.ctx?.compactAt ? { compactAt: info.ctx.compactAt } : {}),
      },
      limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, ...(r.resetsAt ? { resetsAt: r.resetsAt } : {}) })),
    }
    // the 5-hour pace: readings within this window, the last hour of them
    const five = info.limits.find(l => l.kind === 'five_hour')
    const now = await $.clock.now()
    if (five) {
      const last = samples[samples.length - 1]
      if ((five.resetsAt ?? '') !== windowSeen || (last && five.pct < last.pct - 1)) samples = []
      windowSeen = five.resetsAt ?? ''
      if (!last || last.pct !== five.pct) samples.push({ t: now, pct: five.pct })
      samples = samples.filter(x => now - x.t <= 3_600_000)
    }
    info = { ...info, burn: five ? burnOf(samples, now, five.pct, five.resetsAt) : null }
  } catch {
    // keep the last reading
  }
}

// what the info shows (to the second it does not: the clock counts by itself); a change means a rebuild
const keyOf = (now: number) => JSON.stringify([
  info.ctx, info.limits.map(l => [l.kind, Math.round(l.pct)]), Math.round(info.burn?.projected ?? 0), info.working, info.waiting, info.nudge, info.turnAt, info.endAt, agents, stagePx, settings,
  info.limits.some(l => l.pct >= DANGER) ? Math.floor(now / 60_000) : 0, // the reset countdown shows minutes
])
let shownKey = ''

const paint = async ($: Api, draw = true) => {
  if (!stagePx) return
  const now = await $.clock.now()
  svg = render(scene, stagePx, {
    offsetMs: now - sceneAt,
    hud: settings.compact ? '' : hud(stagePx, stageH(), now, info),
    hover: doing,
    click,
    minis: agents,
    hint: '/clawd pack <folder> brings Clawd in',
    motion: settings.motion,
  })
  shownKey = keyOf(now)
  if (draw) $.ui.invalidate('ui.render')
}

// The hover line for each moment of a scene: while busy, what Claude is doing; while idle, a line that fits
// the pose, the walk or the pause, picked fresh each scene so it never says the same thing for long.
const annotate = (sc: Seg[]): Seg[] =>
  sc.map(s => {
    if (s.note) return s
    if (mode === 'busy') return { ...s, note: doing }
    if (mode === 'sleepy') return { ...s, note: 'zzz…' }
    const lines = s.kind === 'pose' && s.pose && HOBBY_LINES[s.pose] ? HOBBY_LINES[s.pose]! : s.kind === 'walk' ? WALK_LINES : IDLE_LINES
    return { ...s, note: pick(rng, lines) }
  })

// Redraw soon so the hover follows the newest tool, without rebuilding on every call of a busy burst.
const repaintSoon = ($: Api) => {
  if (repaintTimer) return
  repaintTimer = $.clock.after(REPAINT_MS, () => {
    repaintTimer = null
    scene = scene.map(s => (mode === 'busy' && !s.say ? { ...s, note: doing } : s))
    void paint($)
  })
}

// A new scene from wherever the mascot is now: a reaction first when given; the next scene is scheduled.
const restage = async ($: Api, cue?: { pose: string; say?: string; ms?: number; note?: string }, draw = true) => {
  if (!stagePx) return
  const now = await $.clock.now()
  const here = scene.length ? at(scene, now - sceneAt) : 40 + rng() * (stagePx - 80)
  scene = annotate(cue ? react(rng, cue.pose, cue.say, here, stagePx, mode, work(), cue.ms, cue.note) : plan(rng, here, stagePx, mode, work()))
  click = { pose: pick(rng, CUES.click), say: pick(rng, SAY.click!) }
  sceneAt = now
  stagedAt = now
  await paint($, draw)
  nextScene?.cancel()
  nextScene = $.clock.after(busyMs(scene), () => void restage($))
}

const cue = ($: Api, c: Cue, say?: string, ms?: number) => restage($, { pose: pick(rng, CUES[c]), say: say ?? (SAY[c] ? pick(rng, SAY[c]!) : undefined), ms })

// Claude is blocked on the person: a permission dialog or a question is on screen for tool call `id`.
// Only the engine's own signal that a dialog is shown starts it (never a check auto mode settles by itself),
// and it ends the moment that call moves on: it returns, it starts running (its progress row draws), the
// turn ends, or the person sends a prompt.
const waitStart = ($: Api, id: string | null) => {
  waitingFor = id
  waitTimer?.cancel()
  waitTimer = $.clock.after(WAIT_SHOW_MS, () => {
    if (waitingFor !== id) return
    info = { ...info, waiting: true }
    waitTallyStart()
    void chime($, 'wait')
    doing = 'waiting for you'
    void restage($, { pose: pick(rng, WORK.ask), say: 'your call?', ms: 600_000, note: 'waiting for you' })
  })
}
const waitEnd = ($: Api, id?: string) => {
  if (id !== undefined && waitingFor !== null && id !== waitingFor) return
  waitTimer?.cancel()
  waitTimer = null
  waitingFor = null
  if (!info.waiting) return
  info = { ...info, waiting: false }
  waitTallyEnd()
  doing = lastLabel
  void restage($)
}
// the tool call a dialog belongs to: the newest running call of that tool, else the newest of any
const callOf = (toolName?: string) => {
  const calls = [...inFlight].reverse()
  return (calls.find(([, t]) => t === toolName) ?? calls[0])?.[0] ?? null
}

// A chime, when the person turned sounds on. Windows: PowerShell's SoundPlayer (Claude Code's own player is
// macOS-only there); macOS: the engine's player; Linux: paplay, else aplay. Never fails a hook.
const chime = async ($: Api, name: 'wait' | 'done') => {
  if (!settings.sound) return
  const file = `${$.plugin.root}/sounds/${name}.wav`
  try {
    if ((await $.env.get('OS')) === 'Windows_NT')
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-c', `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`], { timeoutMs: 10_000 })
    else if ((await $.env.get('HOME'))?.startsWith('/Users/')) await $.audio.play({ asset: `sounds/${name}.wav` })
    else {
      const r = await $.process.run(['paplay', file], { timeoutMs: 10_000 }).catch(() => null)
      if (!r || r.exitCode !== 0) await $.process.run(['aplay', '-q', file], { timeoutMs: 10_000 })
    }
  } catch {
    // no player: stay quiet
  }
}

// waiting on the person, for the tally: counted once however the wait shows (a dialog, a quiet wait)
const waitTallyStart = () => {
  waitSince ??= Date.now()
}
const waitTallyEnd = () => {
  if (waitSince === null || info.waiting || info.nudge) return
  delta.waitMs += Date.now() - waitSince
  waitSince = null
}

// adds this session's tally to the day's record in $.store and starts a fresh delta
const flushStats = async ($: Api): Promise<Day> => {
  const stored = (await $.store.get('stats')) as Day | undefined
  const day = merge(stored, delta)
  await $.store.set('stats', day)
  delta = emptyDay(today(Date.now()))
  return day
}

// A quiet wait: Claude is stuck on the person with no dialog on screen. It polls for a file, arms a watcher
// for something they must do, or ends its turn handing them a job. Clawd holds the sign with what is needed,
// the clock grows a slow yellow ring, and a toast says it once. `untilMs`: a watcher's own deadline.
const nudgeStart = ($: Api, need: string, untilMs?: number) => {
  info = { ...info, nudge: need }
  waitTallyStart()
  doing = `waiting on you for ${need}`
  if (nudgeToasted !== need) {
    nudgeToasted = need
    $.ui.toast(`Claude is waiting on you for ${need}`)
    void chime($, 'wait')
  }
  void restage($, { pose: pick(rng, WORK.ask), say: `needs ${need}`, ms: 600_000, note: doing })
  nudgeTimer?.cancel()
  nudgeTimer = untilMs ? $.clock.after(untilMs, () => nudgeEnd($)) : null
}
const nudgeEnd = ($: Api) => {
  nudgeTimer?.cancel()
  nudgeTimer = null
  nudgeToasted = ''
  if (!info.nudge) return
  info = { ...info, nudge: null }
  waitTallyEnd()
  doing = info.working ? lastLabel : pick(rng, IDLE_LINES)
  void restage($)
}

// the context's change over a stretch, floated once over the CTX number
const flashFrom = (before: number | null, now: number) => {
  const d = before === null || !info.ctx ? 0 : info.ctx.tokens - before
  if (Math.abs(d) >= 1000) info = { ...info, flash: { text: `${d > 0 ? '+' : '−'}${k(Math.abs(d))}`, at: now } }
}

const settle = ($: Api) => {
  sleepy?.cancel()
  sleepy = $.clock.after(SLEEPY_AFTER_MS, () => {
    mode = 'sleepy'
    doing = 'zzz…'
    void restage($)
  })
}

const HELP = [
  '/clawd on | off: show or hide the bar',
  '/clawd compact: mascot only, no stats (again to bring them back)',
  `/clawd size ${SIZES.join(' | ')}: the mascot's size`,
  '/clawd pack <folder>: where the unzipped Claude Mascot Pack is',
  '/clawd motion on | auto | off: always move, follow the OS reduced-motion setting, or stand still',
  '/clawd sound on | off | test: a chime when Claude waits on you and when a long job finishes',
  '/clawd stats: today with Claude, across sessions',
  '/clawd poke: say hi',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('settings')) as Partial<Settings> | undefined
    settings = { ...settings, ...saved }
    setScale(settings.size)
    await $.command.register({ name: 'clawd', description: 'The clawd-bar mascot: on/off, compact, size, where its art is' })
    await refresh($, true)
    settle($)
    // the art loads after startup, so a big first compile never holds up the first prompt
    $.clock.after(0, async () => {
      packNote = await loadPack($).catch(err => `Could not load the mascot art: ${err instanceof Error ? err.message : String(err)}`)
      if (hasPack() && stagePx) await cue($, 'hello')
      else if (stagePx) await paint($)
    })
    // a reset countdown and the limits move while idle too: look once a minute, redraw only on a change
    $.clock.every(60_000, async () => {
      if (info.working) return
      await refresh($)
      if (keyOf(await $.clock.now()) !== shownKey) await paint($)
    })
    const go = await next(e)
    if (!stagePx) helloPending = true
    return go
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').replace(/^["']|["']$/g, '')
    switch (word.toLowerCase()) {
      case 'on':
      case 'off':
        settings = { ...settings, on: word.toLowerCase() === 'on' }
        await saveSettings($)
        await paint($)
        return { text: settings.on ? 'Clawd is back.' : 'Clawd bar hidden. /clawd on brings it back.' }
      case 'compact':
        settings = { ...settings, compact: arg ? arg === 'on' : !settings.compact }
        await saveSettings($)
        await paint($)
        return { text: settings.compact ? 'Compact: just Clawd. /clawd compact again for the stats.' : 'Stats are back.' }
      case 'size': {
        const size = Number(arg)
        if (!SIZES.includes(size)) return { text: `Sizes: ${SIZES.join(', ')} (now ${settings.size}).` }
        settings = { ...settings, size }
        setScale(size)
        await saveSettings($)
        await restage($)
        return { text: `Clawd is size ${size}.` }
      }
      case 'pack': {
        if (!arg) return { text: `Usage: /clawd pack <folder of the unzipped pack>. Get it free: ${PACK_URL}` }
        packNote = await loadPack($, arg).catch(err => `Could not load it: ${err instanceof Error ? err.message : String(err)}`)
        if (hasPack()) await cue($, 'hello')
        return { text: packNote }
      }
      case 'motion': {
        if (!MOTIONS.includes(arg as Motion)) return { text: `Motion: ${MOTIONS.join(', ')} (now ${settings.motion}).` }
        settings = { ...settings, motion: arg as Motion }
        await saveSettings($)
        await paint($)
        return { text: arg === 'on' ? 'Clawd moves.' : arg === 'off' ? 'Clawd stands still.' : 'Clawd follows your OS reduced-motion setting.' }
      }
      case 'sound': {
        const want = arg.toLowerCase()
        if (want === 'test') {
          const was = settings.sound
          settings = { ...settings, sound: true }
          await chime($, 'wait')
          await chime($, 'done')
          settings = { ...settings, sound: was }
          return { text: `Played both chimes. Sound is ${was ? 'on' : 'off'}.` }
        }
        if (want !== 'on' && want !== 'off') return { text: `Sound: on, off or test (now ${settings.sound ? 'on' : 'off'}).` }
        settings = { ...settings, sound: want === 'on' }
        await saveSettings($)
        if (settings.sound) void chime($, 'done')
        return { text: settings.sound ? 'Sound on: a chime when Claude waits on you, and when a long job finishes.' : 'Sound off.' }
      }
      case 'stats': {
        const day = await flushStats($)
        const ctx = info.ctx ? `${info.ctx.pct}% (${k(info.ctx.tokens)} of ${k(info.ctx.window)})` : null
        return { text: format(day, ctx) }
      }
      case 'poke':
        await cue($, 'click')
        return { text: 'Boop.' }
      default:
        return { text: `clawd-bar: ${settings.on ? 'on' : 'off'}${settings.compact ? ', compact' : ''}, size ${settings.size}, motion ${settings.motion}, sound ${settings.sound ? 'on' : 'off'}\n${packNote || 'Art not loaded yet.'}\n\n${HELP}` }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    waitEnd($)
    nudgeEnd($)
    mode = 'busy'
    mood = 'think'
    doing = lastLabel = 'thinking'
    sleepy?.cancel()
    void restage($, { pose: pick(rng, WORK.think), say: '…', ms: 2400 })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    nudgeEnd($)
    info = { ...info, working: true, turnAt: await $.clock.now() }
    ctxBefore = info.ctx?.tokens ?? null
    mode = 'busy'
    ticker?.cancel()
    // the clock counts inside the SVG; this only notices a long turn and new usage figures
    ticker = $.clock.every(5000, async () => {
      const now = await $.clock.now()
      if (now - info.turnAt > LONG_TURN_MS && mood !== 'long' && now - stagedAt > RESTAGE_MS) {
        mood = 'long'
        void restage($)
      }
      await refresh($)
      if (keyOf(now) !== shownKey) await paint($)
    })
    await paint($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const id = String(e.tool_use_id)
    const what = classify(tool, e as unknown as Record<string, unknown>)
    const now = await $.clock.now()
    inFlight.set(id, tool)
    lastLabel = what.label
    delta.tools[what.mood] = (delta.tools[what.mood] ?? 0) + 1
    // a loop polling for a file, or a watcher for something the person does: a quiet wait, not work
    const need = pollNeed(tool, e as unknown as Record<string, unknown>)
    const watcher = need !== null && tool === 'Monitor'
    if (need) nudgeStart($, need, watcher ? Number((e as unknown as { timeout_ms?: number }).timeout_ms ?? 300_000) : undefined)
    else if (!info.waiting) {
      doing = what.label
      if (what.mood !== mood || mode !== 'busy' || now - stagedAt > RESTAGE_MS) {
        // a new kind of work: strike its pose now and say what it is, then carry on from there
        const changed = what.mood !== mood || mode !== 'busy'
        mode = 'busy'
        mood = what.mood
        void restage($, { pose: pick(rng, WORK[mood]), ms: 4000, ...(changed ? { say: what.label } : {}) })
      } else repaintSoon($)
    }
    const isAgent = /^(Agent|Task)$/.test(tool) // ponytail: a background agent returns at once, so it shows only while launching
    if (isAgent) {
      agents++
      await paint($)
    }
    if (/^(AskUserQuestion|ExitPlanMode)$/.test(tool)) waitStart($, id)
    let ran
    try {
      ran = await next(e)
    } finally {
      inFlight.delete(id)
      waitEnd($, id)
      if (need && !watcher) nudgeEnd($) // the polling loop ended: whatever it waited for came (or it gave up)
      if (isAgent) {
        agents = Math.max(0, agents - 1)
        await paint($)
      }
    }
    if ((ran.isError === true || ran.deny !== undefined) && (await $.clock.now()) - lastError > ERROR_COOLDOWN_MS) {
      lastError = await $.clock.now()
      delta.errors++
      void cue($, ran.deny !== undefined ? 'denied' : tool.startsWith('mcp__') ? 'mcpError' : 'error')
    }
    return ran
  })

  // the engine is about to show a permission dialog: the one moment Claude is truly waiting on the person
  on('classic.PermissionRequest', ($, e, next) => {
    waitStart($, callOf(e.tool_name))
    return next(e)
  })
  on('classic.Notification', ($, e, next) => {
    if (/permission|elicitation/.test(e.notification_type)) waitStart($, callOf())
    return next(e)
  })
  // a tool's progress row draws once it runs: whatever dialog held it was answered
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    const id = e.props.tool_use_id
    if (waitingFor === id) $.clock.after(0, () => waitEnd($, id))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const before = info.ctx?.tokens ?? null
    delta.compacts++
    void cue($, 'compact', undefined, 4000)
    const done = await next(e)
    await refresh($, true)
    flashFrom(before, await $.clock.now())
    await paint($)
    return done
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && !info.working) await refresh($, true)
    else await refresh($)
    if (keyOf(await $.clock.now()) !== shownKey) await paint($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    ticker?.cancel()
    ticker = null
    const now = await $.clock.now()
    waitEnd($)
    info = { ...info, working: false, endAt: now, lastMs: e.durationMs }
    delta.turns++
    delta.workMs += e.durationMs
    delta.longestMs = Math.max(delta.longestMs, e.durationMs)
    void flushStats($)
    await refresh($, true)
    flashFrom(ctxBefore, now)
    mode = 'idle'
    mood = 'think'
    doing = pick(rng, IDLE_LINES)
    inFlight.clear()
    settle($)
    const ctxHigh = (info.ctx?.pct ?? 0) >= WARN
    const limitHigh = info.limits.some(l => l.pct >= DANGER)
    // a turn that ends handing the person a job, or with a watcher still armed for them, is a quiet wait
    const need = e.reason === 'answer' ? answerNeed(e.answer) ?? info.nudge : null
    if (need) nudgeStart($, need, 30 * 60_000) // a stale ask fades after half an hour
    else if (e.reason === 'answer') {
      if (limitHigh) void cue($, 'limit')
      else if (ctxHigh) void cue($, 'pressure')
      else if (e.durationMs >= LONG_JOB_MS) {
        // a long job's finish line: the big celebration, held longer, a toast and the done chime
        const took = span(e.durationMs)
        void restage($, { pose: pick(rng, ['rocket-launch-success', 'success-achievement-milestone', 'happy-pixel-celebrating']), say: `done in ${took}!`, ms: 8000, note: `finished a ${took} job` })
        $.ui.toast(`Claude finished a ${took} job`)
        void chime($, 'done')
      } else void cue($, 'done', `done · ${Math.max(1, Math.round(e.durationMs / 1000))}s`)
    } else if (e.reason === 'aborted') void cue($, 'aborted')
    else void cue($, 'fail')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const ui = $.ui.resolve(e)
    if (!settings.on || e.props.hasSurvey || !('Svg' in ui)) return below

    const px = Math.max(220, (e.props.bodyColumns - 2) * CELL_PX)
    if (Math.abs(px - stagePx) >= 12) {
      stagePx = px
      if (helloPending && hasPack()) {
        helloPending = false
        await restage($, { pose: pick(rng, CUES.hello), say: pick(rng, SAY.hello!) }, false)
      } else await restage($, undefined, false) // already drawing: no redraw request from inside a render
    }
    if (keyOf(await $.clock.now()) !== shownKey) await paint($, false)
    if (!svg) return below

    const bar = <ui.Svg key="clawd-bar" source={svg} alt={`Claude's mascot: ${doing}. Context ${info.ctx?.pct ?? '—'}%`} width={stagePx} height={stageH()} isInteractive />
    return below ? (
      <ui.Box key="clawd-bar-wrap" flexDirection="column">
        {bar}
        {below}
      </ui.Box>
    ) : bar
  })
}
