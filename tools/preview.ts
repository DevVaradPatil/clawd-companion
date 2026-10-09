// node tools/preview.ts <unzipped Claude Mascot Pack> [out.html]: the bar in a few states on a dark page, to eyeball
// changes. Also how docs/hero.png is made: render this page with a headless browser at 2x.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { compilePack } from '../clawd-bar/hooks/compile.ts'
import { CUES, WORK } from '../clawd-bar/hooks/poses.ts'
import { hud } from '../clawd-bar/hooks/hud.ts'
import { plan, react, render, stageH, usePack, type Seg } from '../clawd-bar/hooks/stage.ts'

const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith('.svg') ? [join(dir, n)] : []))
const [packDir, out = 'preview.html'] = process.argv.slice(2)
if (!packDir) throw new Error('usage: node tools/preview.ts <unzipped Claude Mascot Pack> [out.html]')
usePack(compilePack(walk(packDir).map(f => ({ name: basename(f, '.svg'), svg: readFileSync(f, 'utf8') }))).pack)
const H = stageH()

let seed = 7
const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const now = Date.now()
const W = 960
const info = (working: boolean, extra: Record<string, unknown> = {}) => ({
  ctx: { pct: 42, tokens: 84000, window: 200000, max: 200000, compactAt: 167000, cats: ([['System prompt', 3000], ['System tools', 17000], ['MCP tools', 9000], ['Memory files', 4000], ['Skills', 3000], ['Messages', 48000]] as const).map(([name, tokens]) => ({ name, tokens })) },
  limits: [{ kind: 'five_hour', pct: 23, resetsAt: new Date(now + 8e6).toISOString() }, { kind: 'seven_day', pct: 82 }],
  burn: { projected: 61, fullInMs: null, resetInMs: 8e6 }, waiting: false, flash: null as { text: string; at: number } | null,
  working, turnAt: now - 83000, endAt: now - 724000, lastMs: 95000,
  ...extra,
})
// a scene that holds one pose at x, so a still capture shows it
const hold = (pose: string, x: number, say?: string): Seg[] => [{ kind: 'pose', ms: 600_000, x0: x, x1: x, pose, ...(say ? { say } : {}) }]
const bars: [string, string][] = [ // the first four are stills for docs/hero.png
  ['Editing a file · the 5H pace runs ahead of the fill', render(hold('writing-software-code', 860, 'editing hud.ts'), W, { hud: hud(W, H, now, info(true, { flash: { text: '+12k', at: now - 900 } })) })],
  ['Two subagents at work', render(hold('lab-science-testing', 830), W, { hud: hud(W, H, now, info(true)), minis: 2 })],
  ['Waiting on you · past 90% the limit shows its reset', render(hold('it-depends-sign', 870, 'your call?'), W, { hud: hud(W, H, now, info(true, { waiting: true, limits: [{ kind: 'five_hour', pct: 93, resetsAt: new Date(now + 4.3e6).toISOString() }, { kind: 'seven_day', pct: 82 }], burn: null })) })],
  ['Turn finished', render(hold('rocket-launch-success', 900, 'done · 95s'), W, { hud: hud(W, H, now, info(false)) })],
  ['Idle, wandering (live)', render(plan(r, 500, W, 'idle', CUES.hobby), W, { hud: hud(W, H, now, info(false)), hover: 'taking it easy', click: { pose: 'love-cloud-pixel', say: 'hi!' } })],
  ['Busy (live)', render(react(r, 'thinking-pixel-bubble', '…', 420, W, 'busy', WORK.edit), W, { hud: hud(W, H, now, info(true)), hover: 'editing hud.ts', click: { pose: 'happy-pixel-celebrating', say: 'boop!' } })],
]
const prompt = `<div class="prompt" style="width:${W - 28}px;height:34px;margin-top:-8px;border-radius:14px;color:#6f6d66;padding:12px 14px;font-size:14px">Reply to Claude…</div>`
writeFileSync(out,
  `<!doctype html><meta charset="utf-8"><style>body{background:#1f1e1d}.bar{background:#262624}.prompt{background:#30302e;border:1px solid #3e3d39}@media (prefers-color-scheme:light){body{background:#f5f4ee}.bar{background:#faf9f5}.prompt{background:#fff;border-color:#e3e0d6}}</style><body style="margin:0;padding:28px 32px;font:12px 'Segoe UI',system-ui,sans-serif;color:#85837c">` +
  bars.map(([n, s], i) => (i === 4 ? prompt + '<p style="margin-top:60px">Live scenes (animated):</p>' : '') +
    `<div style="margin:0 0 4px 6px">${n}</div><div class="bar" style="width:${W}px;height:${H}px;margin-bottom:18px;border-radius:12px">${s}</div>`).join('') + '</body>')
console.log('ok', bars.map(([n, s]) => `${n} ${(s.length / 1024).toFixed(1)}KB`).join(' · '))
