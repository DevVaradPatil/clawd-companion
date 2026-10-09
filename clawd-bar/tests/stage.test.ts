import { expect, test } from 'claude-code/testing'
import { WALK_FROM, compilePack } from '../hooks/compile.ts'
import { CUES, PACK_NAMES, WORK, classify } from '../hooks/poses.ts'
import { burnOf, hud, layout } from '../hooks/hud.ts'
import { at, half, plan, react, render, setScale, usePack, type Mode } from '../hooks/stage.ts'

// a stand-in for the pack (the real art is the person's own download): a 4-legged body made of pack-style rects
const px = (x: number, y: number, fill = '#d97757') => `<rect x="${571.025 + x * 42.857}" y="${571.025 + y * 42.857}" width="43.55" height="43.55" fill="${fill}" />`
const body = [...Array(10).keys()].flatMap(x => [0, 1, 2].map(y => px(x, y))).join('') + px(3, 1, '#2f2f38') + [0, 2, 7, 9].flatMap(x => [px(x, 3), px(x, 4)]).join('') // legs are 2 pixels tall, as in the pack
const fake = compilePack([{ name: WALK_FROM, svg: `<svg>${body}</svg>` }]).pack
usePack({ ...fake, sprites: Object.fromEntries(PACK_NAMES.map(n => [n, fake.sprites[WALK_FROM]!])) })

test('the compiler anchors at the feet and splits the legs into two pairs', () => {
  expect(fake.walk.y + fake.walk.h).toBe(0) // feet on y=0
  expect(fake.walk.legA.length > 0 && fake.walk.legB.length > 0).toBe(true)
  expect(compilePack([{ name: 'other', svg: `<svg>${body}</svg>` }, { name: WALK_FROM, svg: `<svg>${body}</svg>` }]).skipped).toEqual([])
})

test('every pack pose has a job, and every job names a pack pose', () => {
  const used = new Set([...Object.values(WORK), ...Object.values(CUES)].flat())
  expect(PACK_NAMES.filter(id => !used.has(id))).toEqual([])
  expect([...used].filter(id => !PACK_NAMES.includes(id))).toEqual([])
})

test('tools map to the right pose family', () => {
  expect(classify('Read', { file_path: 'C:/x/hud.ts' })).toEqual({ mood: 'read', label: 'reading hud.ts' })
  expect(classify('Bash', { command: 'npm test' }).mood).toBe('test')
  expect(classify('Bash', { command: 'git status' }).mood).toBe('git')
  expect(classify('Edit', { file_path: '/a/.claude/settings.json' }).mood).toBe('settings')
  expect(classify('mcp__github__create_pr', {}).mood).toBe('mcp')
})

test('a narrow bar shortens the meters and keeps all three; only the clock may go', () => {
  expect(layout(1100)).toEqual({ order: ['ctx', 'five_hour', 'seven_day', 'clock'], bar: 140 })
  expect(layout(760).order).toEqual(['ctx', 'five_hour', 'seven_day', 'clock'])
  expect(layout(620).order).toEqual(['ctx', 'five_hour', 'seven_day', 'clock'])
  expect(layout(480).order).toEqual(['ctx', 'five_hour', 'seven_day'])
  expect(layout(300).order).toEqual(['ctx', 'five_hour', 'seven_day'])
})

test('random scenes stay on the bar and compile to valid SMIL under the size cap, at every size', () => {
  let seed = 1
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 120; i++) {
    setScale([1, 1.5, 2][i % 3]!)
    const info = { ctx: { pct: 50, tokens: 1e5, window: 2e5, max: 2e5, compactAt: 1.6e5, cats: [{ name: 'Messages', tokens: 9e4 }] }, limits: [{ kind: 'five_hour', pct: 40 }], burn: { projected: 80, fullInMs: null, resetInMs: 6e6 }, working: true, waiting: i % 4 === 0, turnAt: 0, endAt: null, lastMs: null, flash: { text: '+12k', at: 4000 } }
    const width = 220 + Math.floor(r() * 1400)
    const mode = (['idle', 'busy', 'sleepy'] as Mode[])[i % 3]!
    const work = mode === 'sleepy' ? CUES.sleep : mode === 'busy' ? WORK.edit : CUES.hobby
    const sc = i % 2 ? react(r, 'with-success-checkmark', 'done', r() * width, width, mode, work) : plan(r, r() * width, width, mode, work)
    for (const s of sc) {
      expect(s.ms > 0).toBe(true)
      for (const x of [s.x0, s.x1]) expect(x >= half() - 1e-9 && x <= Math.max(half(), width - half()) + 1e-9).toBe(true)
    }
    const svg = render(sc, width, { minis: i % 7, offsetMs: 1234, hud: hud(width, 52, 5000, info), hover: 'editing <x>', click: { pose: 'love-cloud-pixel', say: 'hi!' } })
    expect(svg.length < 131072).toBe(true)
    for (const m of svg.matchAll(/keyTimes="([^"]+)"/g)) {
      const ks = m[1]!.split(';').map(Number)
      expect(ks[0] === 0 && ks.every((k, j) => k >= 0 && k <= 1 && (j === 0 || k > ks[j - 1]!))).toBe(true)
    }
    expect(Number.isFinite(at(sc, 4321))).toBe(true)
  }
  setScale(1)
})

test('with no art yet the bar still draws, with the hint', () => {
  usePack(null)
  const svg = render([], 800, { hud: '', hint: '/clawd pack <folder>' })
  expect(svg.includes('/clawd pack &lt;folder&gt;')).toBe(true)
  usePack({ ...fake, sprites: Object.fromEntries(PACK_NAMES.map(n => [n, fake.sprites[WALK_FROM]!])) })
})

test('the 5-hour pace projects to the reset, and says when 100% comes first', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const reset = new Date(now + 2 * 3_600_000).toISOString()
  // 15 points in 20 minutes: 45/hour, so the last 60 points take 80 minutes, before the 2h reset
  const fast = burnOf([{ t: now - 1_200_000, pct: 25 }], now, 40, reset)!
  expect(fast.projected).toBe(100)
  expect(Math.round(fast.fullInMs! / 60_000)).toBe(80)
  const slow = burnOf([{ t: now - 1_200_000, pct: 38 }], now, 40, reset)!
  expect(Math.round(slow.projected)).toBe(52)
  expect(slow.fullInMs).toBe(null)
  expect(burnOf([{ t: now - 60_000, pct: 30 }], now, 40, reset)).toBe(null) // too little history
  expect(burnOf([{ t: now - 1_200_000, pct: 40 }], now, 40, reset)).toBe(null) // not rising
})
