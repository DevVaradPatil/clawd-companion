import type { Hook, Register } from 'claude-code'
import { WALK_FROM, compilePack, type Pack } from './compile.ts'
import { CUES, PACK_NAMES, SAY, WORK, classify, type Cue, type Mood } from './poses.ts'
import { DANGER, WARN, burnOf, hud, k, type Info, type Sample } from './hud.ts'
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
const WAIT_SHOW_MS = 1_500 // an ask that settles quicker (auto mode's classifier) never shows as waiting
const SIZES = [1, 1.5, 2]
const PACK_URL = 'https://getillustrations.com/illustration-pack/claude-mascot-pack'
const rng = Math.random

// ---------- settings, kept across sessions in $.store ----------
type Settings = { on: boolean; compact: boolean; size: number; motion: Motion }
let settings: Settings = { on: true, compact: false, size: 1, motion: 'on' }
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
let info: Info = { ctx: null, limits: [], burn: null, working: false, waiting: false, turnAt: 0, endAt: null, lastMs: null, flash: null }
let ticker: { cancel: () => void } | null = null
let samples: Sample[] = [] // the 5-hour window's readings, for its pace
let windowSeen = '' // which 5-hour window those readings belong to (its reset time)
let agents = 0 // subagents running now
let ctxBefore: number | null = null // the context's tokens when the turn began
let waitTimer: { cancel: () => void } | null = null

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
  info.ctx, info.limits.map(l => [l.kind, Math.round(l.pct)]), Math.round(info.burn?.projected ?? 0), info.working, info.waiting, info.turnAt, info.endAt, agents, stagePx, settings,
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

// A new scene from wherever the mascot is now: a reaction first when given; the next scene is scheduled.
const restage = async ($: Api, cue?: { pose: string; say?: string; ms?: number }, draw = true) => {
  if (!stagePx) return
  const now = await $.clock.now()
  const here = scene.length ? at(scene, now - sceneAt) : 40 + rng() * (stagePx - 80)
  scene = cue ? react(rng, cue.pose, cue.say, here, stagePx, mode, work(), cue.ms) : plan(rng, here, stagePx, mode, work())
  click = { pose: pick(rng, CUES.click), say: pick(rng, SAY.click!) }
  sceneAt = now
  stagedAt = now
  await paint($, draw)
  nextScene?.cancel()
  nextScene = $.clock.after(busyMs(scene), () => void restage($))
}

const cue = ($: Api, c: Cue, say?: string, ms?: number) => restage($, { pose: pick(rng, CUES[c]), say: say ?? (SAY[c] ? pick(rng, SAY[c]!) : undefined), ms })

// Claude is blocked on the person: shown once the wait outlasts WAIT_SHOW_MS; ends when the tool call returns
const waitStart = ($: Api) => {
  waitTimer?.cancel()
  waitTimer = $.clock.after(WAIT_SHOW_MS, () => {
    info = { ...info, waiting: true }
    doing = 'waiting for you'
    void restage($, { pose: pick(rng, WORK.ask), say: 'your call?', ms: 600_000 })
  })
}
const waitEnd = ($: Api) => {
  waitTimer?.cancel()
  waitTimer = null
  if (!info.waiting) return
  info = { ...info, waiting: false }
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
      case 'poke':
        await cue($, 'click')
        return { text: 'Boop.' }
      default:
        return { text: `clawd-bar: ${settings.on ? 'on' : 'off'}${settings.compact ? ', compact' : ''}, size ${settings.size}, motion ${settings.motion}\n${packNote || 'Art not loaded yet.'}\n\n${HELP}` }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    mode = 'busy'
    mood = 'think'
    doing = 'thinking'
    sleepy?.cancel()
    void restage($, { pose: pick(rng, WORK.think), say: '…', ms: 2400 })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
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
    const what = classify(String(e.tool), e as unknown as Record<string, unknown>)
    const now = await $.clock.now()
    if (mode !== 'sleepy' && (what.mood !== mood || now - stagedAt > RESTAGE_MS)) {
      mode = 'busy'
      mood = what.mood
      doing = what.label
      void restage($)
    } else doing = what.label
    const tool = String(e.tool)
    const isAgent = /^(Agent|Task)$/.test(tool) // ponytail: a background agent returns at once, so it shows only while launching
    if (isAgent) {
      agents++
      await paint($)
    }
    if (/^(AskUserQuestion|ExitPlanMode)$/.test(tool)) waitStart($)
    let ran
    try {
      ran = await next(e)
    } finally {
      waitEnd($)
      if (isAgent) {
        agents = Math.max(0, agents - 1)
        await paint($)
      }
    }
    if ((ran.isError === true || ran.deny !== undefined) && (await $.clock.now()) - lastError > ERROR_COOLDOWN_MS) {
      lastError = await $.clock.now()
      void cue($, ran.deny !== undefined ? 'denied' : tool.startsWith('mcp__') ? 'mcpError' : 'error')
    }
    return ran
  })

  // a permission prompt is coming when the verdict is `ask`; the tool.call hook above ends the wait
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') waitStart($)
    return verdict
  })

  on('session.compact', async ($, e, next) => {
    const before = info.ctx?.tokens ?? null
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
    await refresh($, true)
    flashFrom(ctxBefore, now)
    mode = 'idle'
    mood = 'think'
    doing = 'taking it easy'
    settle($)
    const ctxHigh = (info.ctx?.pct ?? 0) >= WARN
    const limitHigh = info.limits.some(l => l.pct >= DANGER)
    if (e.reason === 'answer') {
      if (limitHigh) void cue($, 'limit')
      else if (ctxHigh) void cue($, 'pressure')
      else void cue($, 'done', `done · ${Math.max(1, Math.round(e.durationMs / 1000))}s`)
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
