// The info row drawn behind the mascot, as SVG markup in CSS px. Fixed-width slots, so nothing shifts as the
// numbers change. Claude's dark palette. Pure: runs under node.

import { esc } from './stage.ts'

export type Cat = { name: string; tokens: number }
export type Burn = { projected: number; fullInMs: number | null; resetInMs: number }
export type Info = {
  ctx: { pct: number; tokens: number; window: number; cats: Cat[]; max: number; compactAt?: number } | null
  limits: { kind: string; pct: number; resetsAt?: string }[]
  burn: Burn | null // the 5-hour window's pace, projected to its reset
  working: boolean
  waiting: boolean // Claude is blocked on the person (a permission prompt, a question)
  turnAt: number // when the running turn began
  endAt: number | null // when the last turn ended
  lastMs: number | null // how long the last turn took
  flash: { text: string; at: number } | null // the context's change over the last turn, floated once
}

const C = { text: '#c2c0b6', muted: '#85837c', faint: '#5e5c56', track: '#353432', clay: '#d97757', yellow: '#e8c468', red: '#e5534b', green: '#7ec699' }
// what fills the context window, coloured per /context category
export const CAT_COLOR: Record<string, string> = {
  'System prompt': '#a3a096',
  'System tools': '#6a9bcc',
  'MCP tools': '#9b87f5',
  'Custom agents': '#c792ea',
  'Memory files': '#e0a458',
  Skills: '#5fb3a1',
  'Slash commands': '#7fb4a8',
  Messages: '#d97757',
  'Autocompact buffer': '#4a4843',
}
const EXTRA = ['#b9a37a', '#8fa8c8', '#c78f8f', '#9ab38a']
export const colorOf = (name: string) =>
  CAT_COLOR[name] ?? EXTRA[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % EXTRA.length]!

// one rule for every meter: Claude orange until 75%, yellow from 75%, red from 90%
export const WARN = 75
export const DANGER = 90
export const tone = (p: number) => (p >= DANGER ? C.red : p >= WARN ? C.yellow : C.text)
export const fillOf = (p: number) => (p >= DANGER ? C.red : p >= WARN ? C.yellow : C.clay)

export const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}
const short = (ms: number) => span(ms).replace(/ \d+s$/, '').replace(' ', '') // 1h12m, 40m, 2d3h

// The 5-hour window's pace from readings over the last hour: where it lands at the reset, and when it would
// hit 100% first. Null until there are 4+ minutes of rising readings. Pure, for the tests.
export type Sample = { t: number; pct: number }
export const burnOf = (samples: Sample[], now: number, pct: number, resetsAt?: string): Burn | null => {
  const reset = resetsAt ? Date.parse(resetsAt) - now : NaN
  const first = samples.find(s => now - s.t <= 3_600_000)
  if (!first || !Number.isFinite(reset) || reset <= 0 || now - first.t < 240_000 || pct <= first.pct) return null
  const rate = (pct - first.pct) / (now - first.t) // points per ms
  const toFull = (100 - pct) / rate
  return { projected: Math.min(100, pct + rate * reset), fullInMs: toFull < reset ? toFull : null, resetInMs: reset }
}

const FS = 13.5 // value text
const CW = FS * 0.6 // monospace advance
const LFS = 11 // slot labels
const SANS = 'font-family="Segoe UI,system-ui,-apple-system,sans-serif"'
const MONO = 'font-family="Cascadia Mono,Consolas,ui-monospace,monospace"'
let BAR = 96 // every meter: same length (shrunk to fit a narrow bar), height and label column
const BH = 6
const LABEL_W = 34
const label = (x: number, y: number, t: string) => `<text x="${x}" y="${y + 4}" font-size="${LFS}" letter-spacing="1" font-weight="600" ${SANS} fill="${C.muted}">${t}</text>`
const value = (x: number, y: number, t: string, fill: string) => `<text x="${x.toFixed(1)}" y="${y + 4.5}" font-size="${FS}" ${MONO} fill="${fill}">${esc(t)}</text>`
const track = (bx: number, y: number) => `<rect x="${bx}" y="${y - BH / 2}" width="${BAR}" height="${BH}" rx="${BH / 2}" fill="${C.track}"/>`
const onehot = (n: number, i: number) => Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)).join(';')
// hovering a slot shows its <title>; a transparent rect gives the whole slot a hover area
const slot = (x: number, w: number, y: number, title: string, inner: string) =>
  `<g><title>${esc(title)}</title><rect x="${x - 4}" y="${y - 13}" width="${w}" height="26" fill="transparent"/>${inner}</g>`

// the slots' widths: a meter's slot is its bar plus the label and number around it
type SlotName = 'ctx' | 'five_hour' | 'seven_day' | 'clock'
const AROUND: Record<SlotName, number> = { ctx: 120, five_hour: 112, seven_day: 112, clock: 112 } // label + number + a small gap
const slotW = (s: SlotName) => AROUND[s] + (s === 'clock' ? 0 : BAR)
const MAX_BAR = 140
const MIN_BAR = 40

const ctxSlot = (x: number, y: number, now: number, ctx: Info['ctx'], flash: Info['flash']) => {
  const bx = x + LABEL_W
  let bar = track(bx, y)
  let title = 'Context: no reading yet'
  if (ctx) {
    // segments per category of what is in the window, scaled to the window; the % is the API's own figure
    let at = 0
    const segs = ctx.cats.filter(c => c.tokens > 0 && ctx.max > 0)
    let fill = ''
    if (segs.length) {
      for (const c of segs) {
        const w = Math.min(BAR - at, (c.tokens / ctx.max) * BAR)
        if (w <= 0) break
        fill += `<rect x="${(bx + at).toFixed(2)}" y="${y - BH / 2}" width="${w.toFixed(2)}" height="${BH}" fill="${colorOf(c.name)}"/>`
        at += w
      }
    } else fill = `<rect x="${bx}" y="${y - BH / 2}" width="${((Math.min(ctx.pct, 100) / 100) * BAR).toFixed(2)}" height="${BH}" fill="${C.clay}"/>`
    bar = `<defs><clipPath id="ctxclip"><rect x="${bx}" y="${y - BH / 2}" width="${BAR}" height="${BH}" rx="${BH / 2}"/></clipPath></defs>` +
      bar + `<g clip-path="url(#ctxclip)">${fill}</g>`
    // where auto-compact kicks in: a tick across the bar
    if (ctx.compactAt && ctx.max > 0 && ctx.compactAt < ctx.max) {
      const cx = bx + (ctx.compactAt / ctx.max) * BAR
      bar += `<rect x="${(cx - 0.75).toFixed(2)}" y="${y - BH / 2 - 3}" width="1.5" height="${BH + 6}" rx="0.75" fill="${C.text}" opacity="0.75"/>`
    }
    title = `Context ${ctx.pct}% · ${k(ctx.tokens)} of ${k(ctx.window)}` +
      (ctx.compactAt ? `\nAuto-compact at ${k(ctx.compactAt)} (the tick)` : '') +
      (segs.length ? '\n\n' + segs.map(c => `${c.name}  ${k(c.tokens)}`).join('\n') : '')
  }
  const pct = ctx ? `${ctx.pct}%` : '—'
  const vx = bx + BAR + 10
  let out = label(x, y, 'CTX') + bar + value(vx, y, pct, ctx ? tone(ctx.pct) : C.faint) +
    (ctx ? value(vx + pct.length * CW + 6, y, k(ctx.tokens), C.faint) : '')
  // the last turn's change floats up from the number once, then fades
  const age = flash ? now - flash.at : Infinity
  if (flash && age < 3200) {
    const up = flash.text.startsWith('+')
    out += `<text x="${vx.toFixed(1)}" y="${y - 9}" font-size="11.5" font-weight="700" ${MONO} fill="${up ? C.clay : C.green}" opacity="0" class="flash" pointer-events="none">${esc(flash.text)}` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.6;1" dur="3.2s" begin="-${(age / 1000).toFixed(3)}s" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 4;0 -8" dur="3.2s" begin="-${(age / 1000).toFixed(3)}s" fill="freeze"/></text>`
  }
  return slot(x, slotW('ctx'), y, title, out)
}

const limitSlot = (x: number, y: number, kind: 'five_hour' | 'seven_day', l: Info['limits'][number] | undefined, burn: Burn | null, now: number) => {
  const bx = x + LABEL_W
  const name = kind === 'five_hour' ? '5H' : '7D'
  const long = kind === 'five_hour' ? '5-hour' : 'Weekly'
  const p = l ? Math.min(l.pct, 100) : 0
  const resets = l?.resetsAt ? Date.parse(l.resetsAt) - now : NaN
  const hasReset = Number.isFinite(resets) && resets > 0
  let title = l ? `${long} limit · ${l.pct}% used${hasReset ? ` · resets in ${span(resets)}` : ''}` : `${long} limit: no reading yet (shows after the first reply on a subscription)`
  let bar = track(bx, y)
  if (l && p > 0) {
    const w = Math.max(BH, (p / 100) * BAR)
    // the pace: a faint fill out to where it lands at the reset, ended by a tick
    if (burn && burn.projected > p + 1) {
      const px = bx + (burn.projected / 100) * BAR
      const c = fillOf(burn.projected)
      bar += `<rect x="${(bx + w - BH).toFixed(2)}" y="${y - BH / 2}" width="${(px - bx - w + BH).toFixed(2)}" height="${BH}" rx="${BH / 2}" fill="${c}" opacity="0.28"/>` +
        `<rect x="${(px - 1).toFixed(2)}" y="${y - BH / 2 - 3}" width="2" height="${BH + 6}" rx="1" fill="${c}"/>`
      title += burn.fullInMs !== null ? `\nAt this pace: 100% in ~${short(burn.fullInMs)}, before the reset` : `\nAt this pace: ~${Math.round(burn.projected)}% by the reset`
    }
    bar += `<rect x="${bx}" y="${y - BH / 2}" width="${w.toFixed(2)}" height="${BH}" rx="${BH / 2}" fill="${fillOf(p)}"/>`
  }
  // past the danger line the reset time matters more than the percentage
  const text = !l ? '—' : p >= DANGER && hasReset ? `↻ ${short(resets)}` : `${Math.round(l.pct)}%`
  return slot(x, slotW(kind), y, title, label(x, y, name) + bar + value(bx + BAR + 10, y, text, l ? tone(l.pct) : C.faint))
}

// h:mm:ss as digit wheels started in the past by the time already gone: it counts with no rebuild
const wheels = (x: number, y: number, sinceMs: number, fill: string) => {
  const e = Math.max(0, sinceMs / 1000).toFixed(3)
  const glyph = (i: number, t: string) => `<text x="${(x + i * CW).toFixed(1)}" y="${y + 4.5}" font-size="${FS}" ${MONO} fill="${fill}">${t}</text>`
  const wheel = (i: number, n: number, period: number) =>
    Array.from({ length: n }, (_, d) =>
      `<text x="${(x + i * CW).toFixed(1)}" y="${y + 4.5}" opacity="0" font-size="${FS}" ${MONO} fill="${fill}">${d}` +
      `<animate attributeName="opacity" values="${onehot(n, d)}" calcMode="discrete" dur="${period}s" begin="-${e}s" repeatCount="indefinite"/></text>`).join('')
  return wheel(0, 10, 36000) + glyph(1, ':') + wheel(2, 6, 3600) + wheel(3, 10, 600) + glyph(4, ':') + wheel(5, 6, 60) + wheel(6, 10, 10)
}

const clockSlot = (x: number, y: number, now: number, i: Info) => {
  if (i.working) {
    const c = i.waiting ? C.yellow : C.clay
    const dot = `<circle cx="${x + 4}" cy="${y}" r="3.5" fill="${c}"><animate attributeName="opacity" values="1;0.2;1" dur="${i.waiting ? 0.9 : 1.6}s" repeatCount="indefinite"/></circle>`
    const title = i.waiting ? 'Waiting for you: Claude needs an answer or a permission' : 'Claude is working: time this turn has run'
    return slot(x, slotW('clock'), y, title, dot + wheels(x + 14, y, now - i.turnAt, i.waiting ? C.yellow : '#ecebe6'))
  }
  if (i.endAt === null) return slot(x, 20, y, 'Ready: no turn has run in this session yet', `<circle cx="${x + 4}" cy="${y}" r="3.5" fill="none" stroke="${C.muted}" stroke-width="1.5"/>`)
  const title = `Last turn ran ${span(i.lastMs ?? 0)} and finished at ${new Date(i.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return slot(x, slotW('clock'), y, title,
    `<circle cx="${x + 4}" cy="${y}" r="3" fill="none" stroke="${C.muted}"/>` + wheels(x + 14, y, now - i.endAt, C.muted) +
    `<text x="${(x + 14 + 7 * CW + 6).toFixed(1)}" y="${y + 4}" font-size="${LFS - 1}" letter-spacing="1" font-weight="600" ${SANS} fill="${C.faint}">AGO</text>`)
}

// Lays the slots out from the left. A narrow bar shortens all three meters alike first; past that the clock
// goes. The three meters always stay.
export const layout = (W: number): { order: SlotName[]; bar: number } => {
  const fit = (order: SlotName[]) => (W - 14 - order.reduce((n, s) => n + AROUND[s], 0)) / 3
  const full: SlotName[] = ['ctx', 'five_hour', 'seven_day', 'clock']
  if (fit(full) >= MIN_BAR) return { order: full, bar: Math.min(MAX_BAR, Math.floor(fit(full))) }
  const meters: SlotName[] = ['ctx', 'five_hour', 'seven_day']
  return { order: meters, bar: Math.max(16, Math.min(MAX_BAR, Math.floor(fit(meters)))) }
}

export const hud = (W: number, Hpx: number, now: number, i: Info) => {
  const y = Math.round(Hpx / 2) + 1
  const { order, bar } = layout(W)
  BAR = bar
  let x = 14
  let out = ''
  for (const s of order) {
    if (s === 'ctx') out += ctxSlot(x, y, now, i.ctx, i.flash)
    else if (s === 'clock') out += clockSlot(x, y, now, i)
    else out += limitSlot(x, y, s, i.limits.find(l => l.kind === s), s === 'five_hour' ? i.burn : null, now)
    x += slotW(s)
  }
  // the ground the mascot walks on: a faint dotted line
  out += `<line x1="8" y1="${Hpx - 1.5}" x2="${W - 8}" y2="${Hpx - 1.5}" stroke="#3a3936" stroke-width="1" stroke-dasharray="1 3"/>`
  return out
}
