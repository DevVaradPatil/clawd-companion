// The stage: a scene (timed segments) compiled into one self-animating SVG. SMIL does every frame in the
// browser, so the mod rebuilds the SVG only when the scene or the shown numbers change, and a rebuild resumes
// mid-scene (negative begin). Pattern from the pika-bar mod, where it is proven on the desktop. Pure: runs under node.

import type { Pack, Sprite } from './compile.ts'

// The art: compiled at runtime from the person's own copy of the pack (see register.tsx), null until then.
let PACK: Pack | null = null
export const usePack = (p: Pack | null) => {
  PACK = p
  setScale(K)
}
export const hasPack = () => PACK !== null

// Size: K is CSS px per art half-pixel (the walking body is 22K px tall); the stage fits the tallest pose (46K).
let K = 1
let H = 52
let GROUND = H - 2
let HALF = 26 // how close to an edge the anchor may come
export const setScale = (k: number) => {
  K = k
  H = Math.ceil(46 * K) + 6
  GROUND = H - 2
  HALF = ((PACK?.walk.w ?? 40) / 2) * K + 6
}
export const stageH = () => H
export const half = () => HALF
const SPEED = 32 // walking, CSS px per second

export type Seg = { kind: 'walk' | 'stand' | 'pose'; ms: number; x0: number; x1: number; pose?: string; say?: string }
export type Mode = 'idle' | 'busy' | 'sleepy'
type Rng = () => number

export const pick = <T,>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
const between = (r: Rng, a: number, b: number) => a + r() * (b - a)
const clampX = (x: number, width: number) => Math.min(Math.max(HALF, x), Math.max(HALF, width - HALF))

// `work`: the poses of what Claude is doing now (busy), or the hobbies it picks from (idle).
export const plan = (r: Rng, from: number, width: number, mode: Mode, work: string[], count = 12): Seg[] => {
  let x = clampX(from, width)
  const out: Seg[] = []
  const stay = (kind: Seg['kind'], ms: number, pose?: string): Seg => ({ kind, ms, x0: x, x1: x, ...(pose ? { pose } : {}) })
  const weights: Record<Mode, [string, number][]> = {
    idle: [['walk', 6], ['stand', 2], ['pose', 2]],
    busy: [['pose', 6], ['walk', 2.5], ['stand', 0.5]],
    sleepy: [['pose', 1]],
  }
  const choose = () => {
    let t = r() * weights[mode].reduce((s, [, w]) => s + w, 0)
    for (const [k, w] of weights[mode]) if ((t -= w) <= 0) return k
    return 'walk'
  }
  for (let i = 0; i < count; i++) {
    const k = choose()
    if (k === 'walk') {
      const lo = HALF
      const hi = Math.max(HALF, width - HALF)
      let to = between(r, lo, hi)
      if (Math.abs(to - x) < 60) to = x > (lo + hi) / 2 ? between(r, lo, x - 30) : between(r, x + 30, hi)
      to = Math.round(clampX(to, width))
      if (Math.abs(to - x) < 8) continue
      out.push({ kind: 'walk', ms: Math.round((Math.abs(to - x) / SPEED) * 1000), x0: x, x1: to })
      x = to
    } else if (k === 'stand') out.push(stay('stand', between(r, 1500, 3500)))
    else if (mode === 'sleepy') out.push(stay('pose', between(r, 20000, 40000), work[0]))
    else out.push(stay('pose', mode === 'busy' ? between(r, 4000, 8000) : between(r, 4000, 9000), pick(r, work)))
  }
  // a long hold at the end, so a late rebuild never leaves it frozen mid-step
  const last = mode === 'idle' ? stay('stand', 600_000) : stay('pose', 600_000, mode === 'sleepy' ? work[0] : pick(r, work))
  out.push(last)
  return out
}

// A reaction first (a pose held a moment, with a line), then the mode's usual life from the same spot.
export const react = (r: Rng, pose: string, say: string | undefined, from: number, width: number, mode: Mode, work: string[], ms = 3200): Seg[] => {
  const x = clampX(from, width)
  return [{ kind: 'pose', ms, x0: x, x1: x, pose, ...(say ? { say } : {}) }, ...plan(r, x, width, mode, work)]
}

export const at = (scene: Seg[], t: number): number => {
  let acc = 0
  for (const s of scene) {
    if (t < acc + s.ms) return s.x0 + (s.x1 - s.x0) * ((t - acc) / s.ms)
    acc += s.ms
  }
  return scene[scene.length - 1]?.x1 ?? 0
}
export const busyMs = (scene: Seg[]) => scene.slice(0, -1).reduce((s, x) => s + x.ms, 0)

// ---------- drawing ----------

const f = (n: number) => +n.toFixed(4)
export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const onehot = (n: number, i: number) => Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)).join(';')
const MONO = 'font-family="Cascadia Mono,Consolas,ui-monospace,monospace"'

// a pose sprite, its feet on y=0 (props hanging below the feet lift it up)
const art = (s: Sprite) => `<g transform="translate(0 ${f(-Math.max(0, s.y + s.h) * K)}) scale(${K})">${s.d}</g>`
const bob = (ms: number) => `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-K}" calcMode="discrete" dur="${ms}ms" repeatCount="indefinite"/>`

// the walk cycle: one leg pair lifted, both down, the other pair lifted, both down; the body dips on each step
const walkFrames = (phaseMs = 0) => {
  const WALK = PACK!.walk
  const frames = [
    `<g transform="translate(0 ${-K})">${WALK.body}</g>${WALK.legB}<g transform="translate(0 ${-2 * K})">${WALK.legA}</g>`,
    `${WALK.body}${WALK.legA}${WALK.legB}`,
    `<g transform="translate(0 ${-K})">${WALK.body}</g>${WALK.legA}<g transform="translate(0 ${-2 * K})">${WALK.legB}</g>`,
    `${WALK.body}${WALK.legA}${WALK.legB}`,
  ]
  return frames
    .map((fr, i) => `<g opacity="${i ? 0 : 1}"><animate attributeName="opacity" values="${onehot(4, i)}" calcMode="discrete" dur="560ms"${phaseMs ? ` begin="-${phaseMs}ms"` : ''} repeatCount="indefinite"/><g transform="scale(${K})">${fr}</g></g>`)
    .join('')
}
const still = () => `<g transform="scale(${K})">${PACK!.walk.body}${PACK!.walk.legA}${PACK!.walk.legB}</g>`
const standing = () => `<g>${bob(1400)}${still()}</g>`

// a speech bubble beside the mascot, on the side with more room
const bubble = (text: string, left: boolean, y = 8) => {
  const fs = 10.5
  const w = Math.round(text.length * fs * 0.6 + 12)
  const x = left ? -HALF - w + 4 : HALF - 4
  return `<g pointer-events="none"><rect x="${x}" y="${y - GROUND}" width="${w}" height="17" rx="8.5" fill="#30302e" stroke="#4a4843"/>` +
    `<text x="${x + w / 2}" y="${y - GROUND + 12}" font-size="${fs}" ${MONO} fill="#ecebe6" text-anchor="middle">${esc(text)}</text></g>`
}

export type RenderOpts = {
  offsetMs?: number // how far into the scene this drawing starts
  hud?: string // the info row, CSS px markup drawn behind the mascot
  hover?: string // what a hover over the mascot says
  click?: { pose: string; say: string } // what a click on it does
  minis?: number // subagents running: half-size mascots trailing it
  hint?: string // drawn in the mascot's place when there is no art yet
  motion?: Motion // on: always animate; auto: still when the OS asks for reduced motion; off: always still
}
export type Motion = 'on' | 'auto' | 'off'

const MINI = 0.5
const MAX_MINIS = 4

// Light mode: the bar's own palette, swapped by attribute (the mascot's art keeps its colours).
const LIGHT: [string, string][] = [
  ['#c2c0b6', '#3d3929'], ['#85837c', '#6f6b62'], ['#5e5c56', '#a19d93'], ['#353432', '#e6e2d8'], ['#ecebe6', '#29261b'],
  ['#30302e', '#ffffff'], ['#4a4843', '#d6d1c4'], ['#3a3936', '#d6d1c4'], ['#e8c468', '#b8860b'], ['#e5534b', '#c8372d'], ['#7ec699', '#2f855a'],
]
const style = (motion: Motion = 'on') =>
  // the frame may wrap the SVG in a page: no margins, fill it exactly (else the feet get clipped)
  ':root{color-scheme:light dark;background:transparent}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}' +
  '#still{display:none}' +
  `@media (prefers-color-scheme:light){${LIGHT.map(([d, l]) => `[fill="${d}"]{fill:${l}}[stroke="${d}"]{stroke:${l}}`).join('')}}` +
  // reduced motion: a still mascot in place of the wandering one, no floating numbers
  // still mode: a still mascot in place of the wandering one, no floating numbers. Not the default for `auto`'s
  // sake alone: Windows reports reduced motion whenever "Show animations" is off, which many turn off for speed.
  (motion === 'off' ? STILL : motion === 'auto' ? `@media (prefers-reduced-motion:reduce){${STILL}}` : '')
const STILL = '#mover,.flash{display:none}#still{display:inline}'

export const render = (scene: Seg[], width: number, opts: RenderOpts = {}): string => {
  if (!PACK) {
    const hint = opts.hint ? `<text x="${f(width - 12)}" y="${f(H / 2 + 5)}" font-size="12" ${MONO} fill="#85837c" text-anchor="end">${esc(opts.hint)}</text>` : ''
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(width)} ${H}" preserveAspectRatio="xMidYMax meet"><style>${style(opts.motion)}</style>${opts.hud ?? ''}${hint}</svg>`
  }
  const SPRITES = PACK.sprites
  const WALK = PACK.walk
  const T = scene.reduce((s, x) => s + x.ms, 0)
  const starts: number[] = []
  scene.reduce((acc, s) => (starts.push(acc), acc + s.ms), 0)
  const kt = (ms: number) => f(ms / T)
  const segTimes = starts.map(kt).join(';')
  const anim = (values: string, keyTimes: string) =>
    `<animate attributeName="opacity" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${T}ms" fill="freeze"/>`
  const windowed = (from: number, to: number) => {
    const a = kt(from)
    const b = Math.max(kt(Math.min(to, T - 1)), a + 0.0001)
    return a <= 0 ? anim('1;0', `0;${f(b)}`) : anim('0;1;0', `0;${a};${f(b)}`)
  }
  const shownWhile = (test: (s: Seg) => boolean) => anim(scene.map(s => (test(s) ? 1 : 0)).join(';'), segTimes)

  // one group per look (walking, standing, each pose), visible while a segment of that look runs
  let body = ''
  if (scene.some(s => s.kind === 'walk')) body += `<g opacity="0">${shownWhile(s => s.kind === 'walk')}${walkFrames()}</g>`
  if (scene.some(s => s.kind === 'stand')) body += `<g opacity="0">${shownWhile(s => s.kind === 'stand')}${standing()}</g>`
  for (const id of new Set(scene.flatMap(s => (s.kind === 'pose' && s.pose && SPRITES[s.pose] ? [s.pose] : [])))) {
    body += `<g opacity="0">${shownWhile(s => s.kind === 'pose' && s.pose === id)}<g>${bob(1200)}${art(SPRITES[id]!)}</g></g>`
  }

  // lines it says, riding along beside it
  let ride = ''
  scene.forEach((s, i) => {
    if (s.say) ride += `<g opacity="0">${windowed(starts[i]!, starts[i]! + Math.min(s.ms, 2800))}${bubble(s.say, s.x0 > width / 2)}</g>`
    if (s.kind === 'pose' && s.pose === 'sleeping-soundly')
      ride += `<g opacity="0" pointer-events="none">${windowed(starts[i]!, starts[i]! + s.ms)}<g><animateTransform attributeName="transform" type="translate" values="0 0;3 -4;6 -8" calcMode="discrete" dur="2.4s" repeatCount="indefinite"/>` +
        `<text x="14" y="${-30}" font-size="10" ${MONO} font-weight="700" fill="#a5b4fc">z</text></g></g>`
  })

  // hover: what it is up to; click: a hop, a reaction pose and a line, all inside the SVG
  const left = (scene[0]?.x0 ?? 0) > width / 2
  const hover = opts.hover ? `<g opacity="0"><set attributeName="opacity" to="1" begin="clawd.mouseover" end="clawd.mouseout"/>${bubble(opts.hover, left, 2)}</g>` : ''
  const click = opts.click && SPRITES[opts.click.pose]
    ? `<g opacity="0"><set attributeName="opacity" to="1" begin="clawd.click" dur="2.4s"/>${art(SPRITES[opts.click.pose]!)}${bubble(opts.click.say, !left, 2)}</g>`
    : ''
  // subagents: little ones trotting beside it, on the side toward the middle of the bar
  const n = Math.max(0, opts.minis ?? 0)
  const dir = left ? -1 : 1
  let minis = ''
  for (let i = 0; i < Math.min(n, MAX_MINIS); i++) {
    const mx = dir * (HALF + 6 + (WALK.w * K * MINI) / 2 + i * (WALK.w * K * MINI + 6))
    minis += `<g pointer-events="none" transform="translate(${f(mx)} 0) scale(${MINI})">${walkFrames(i * 140 + 70)}</g>`
  }
  if (n > MAX_MINIS) {
    const mx = dir * (HALF + 10 + MAX_MINIS * (WALK.w * K * MINI + 6))
    minis += `<text x="${f(mx)}" y="-3" font-size="10" ${MONO} fill="#85837c" text-anchor="middle" pointer-events="none">+${n - MAX_MINIS}</text>`
  }
  const hideOnClick = click ? `<set attributeName="opacity" to="0" begin="clawd.click" dur="2.4s"/>` : ''

  const xs = [scene[0]?.x0 ?? HALF, ...scene.map(s => s.x1)].map(x => `${f(x)} ${GROUND}`).join(';')
  const ts = [...starts.map(kt), 1].join(';')
  const mover =
    `<g><animateTransform attributeName="transform" type="translate" values="${xs}" keyTimes="${ts}" dur="${T}ms" fill="freeze"/>` +
    `<g id="clawd" style="cursor:pointer"><animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 -11;0 -6;0 0" dur="0.5s" begin="clawd.click"/>` +
    `<g>${hideOnClick}${body}</g>${click}` +
    `<rect x="${-HALF}" y="${-24 * K}" width="${2 * HALF}" height="${24 * K}" fill="transparent"/></g>${minis}${ride}${hover}</g>`

  // reduced motion: it stands still near the right end, in the scene's first look
  const first = scene[0]?.kind === 'pose' && scene[0].pose && SPRITES[scene[0].pose] ? art(SPRITES[scene[0].pose]!) : still()
  const stillOne = `<g id="still" transform="translate(${f(Math.max(HALF, width - HALF * 2))} ${GROUND})">${first}</g>`
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(width)} ${H}" preserveAspectRatio="xMidYMax meet">` +
    `<style>${style(opts.motion)}</style>${opts.hud ?? ''}<g shape-rendering="crispEdges"><g id="mover">${mover}</g>${stillOne}</g></svg>`
  const off = Math.max(0, Math.round(opts.offsetMs ?? 0))
  return off ? out.replaceAll(`dur="${T}ms"`, `dur="${T}ms" begin="-${off}ms"`) : out
}
