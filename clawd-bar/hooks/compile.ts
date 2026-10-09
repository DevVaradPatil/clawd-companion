// Compiles the Claude Mascot Pack SVGs (2000x2000, one <rect> per pixel) into compact pixel sprites.
// The mod runs this on the person's own copy of the pack (the art is not redistributed), and caches the result.
// Units are half-pixels of the art (pitch 42.86/2), anchored at the body's centre (x=0) and its feet (y=0).
// Pure: no fs, runs in the hooks environment and under node.

export type Sprite = { x: number; y: number; w: number; h: number; d: string }
export type Walk = { x: number; y: number; w: number; h: number; body: string; legA: string; legB: string }
export type Pack = { walk: Walk; sprites: Record<string, Sprite> }

const U = 42.857 / 2
const ORIGIN = 571.025 // a pixel edge every sprite shares
const BODY = '#d97757'
const FACE = new Set([BODY, '#2f2f38', '#fff'])
const RECT = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: transform="translate\(([-\d.]+),([-\d.]+)\) rotate\(([-\d.]+)\)")? fill="([^"]+)"/g
export const WALK_FROM = 'fast-performance-trail' // the plainest pose: its body becomes the walk cycle

type Cells = Map<string, string> // "x,y" -> colour
const key = (x: number, y: number) => `${x},${y}`
const unkey = (k: string) => k.split(',').map(Number) as [number, number]

const cells = (svg: string): Cells => {
  const out: Cells = new Map()
  for (const m of svg.matchAll(RECT)) {
    let [x, y, w, h] = m.slice(1, 5).map(Number) as [number, number, number, number]
    if (m[7]) { // translate(tx,ty) rotate(r): map the corners, keep their box
      const a = (Number(m[7]) * Math.PI) / 180
      const pts = ([[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const).map(([px, py]) =>
        [px * Math.cos(a) - py * Math.sin(a) + Number(m[5]), px * Math.sin(a) + py * Math.cos(a) + Number(m[6])] as const)
      x = Math.min(...pts.map(p => p[0])); y = Math.min(...pts.map(p => p[1]))
      w = Math.max(...pts.map(p => p[0])) - x; h = Math.max(...pts.map(p => p[1])) - y
    }
    const qx = Math.round((x - ORIGIN) / U), qy = Math.round((y - ORIGIN) / U)
    const qw = Math.max(1, Math.round(w / U)), qh = Math.max(1, Math.round(h / U))
    for (let i = 0; i < qw; i++) for (let j = 0; j < qh; j++) out.set(key(qx + i, qy + j), m[8]!.toLowerCase())
  }
  return out
}

// one <path> per colour, each horizontal run of a row one rectangle
const paths = (cs: Cells) => {
  const by = new Map<string, Map<number, number[]>>()
  const sorted = [...cs].map(([k, c]) => [...unkey(k), c] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  for (const [x, y, c] of sorted) {
    if (!by.has(c)) by.set(c, new Map())
    const rows = by.get(c)!
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push(x)
  }
  let out = ''
  for (const [c, rows] of by) {
    let d = ''
    for (const [y, xs] of rows) {
      for (let i = 0; i < xs.length;) {
        let j = i
        while (j + 1 < xs.length && xs[j + 1] === xs[j]! + 1) j++
        d += `M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`
        i = j + 1
      }
    }
    out += `<path fill="${c}" d="${d}"/>`
  }
  return out
}

const anchor = (cs: Cells): Cells => {
  const body = [...cs].filter(([, c]) => c === BODY).map(([k]) => unkey(k))
  if (!body.length) throw new Error('no mascot body colour (#d97757)')
  const xs = body.map(p => p[0])
  const ground = Math.max(...body.map(p => p[1])) + 1
  const cx = Math.floor((Math.min(...xs) + Math.max(...xs) + 1) / 2)
  return new Map([...cs].map(([k, c]) => { const [x, y] = unkey(k); return [key(x - cx, y - ground), c] }))
}

const box = (cs: Cells) => {
  const ps = [...cs.keys()].map(unkey)
  const xs = ps.map(p => p[0]), ys = ps.map(p => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 }
}

// `files`: each SVG's name (no extension) and its text. Throws when the walking pose is missing.
export const compilePack = (files: { name: string; svg: string }[]): { pack: Pack; skipped: string[] } => {
  const sprites: Record<string, Sprite> = {}
  const skipped: string[] = []
  for (const { name, svg } of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    try {
      const cs = anchor(cells(svg))
      sprites[name] = { ...box(cs), d: paths(cs) }
    } catch {
      skipped.push(name)
    }
  }
  const src = files.find(f => f.name === WALK_FROM)
  if (!src) throw new Error(`the pack has no ${WALK_FROM}.svg`)
  // the walking body: face kept, props dropped; its four legs split into two pairs for a step cycle
  const plain: Cells = new Map([...anchor(cells(src.svg))].filter(([, c]) => FACE.has(c)))
  const legs: Cells = new Map([...plain].filter(([k, c]) => unkey(k)[1] >= -4 && c === BODY))
  const trunk: Cells = new Map([...plain].filter(([k]) => !legs.has(k)))
  const pair = new Map<number, number>()
  let leg = -1
  let last: number | null = null
  for (const x of [...new Set([...legs.keys()].map(k => unkey(k)[0]))].sort((a, b) => a - b)) {
    if (last === null || x !== last + 1) leg++
    pair.set(x, leg % 2)
    last = x
  }
  const walk: Walk = {
    ...box(plain),
    body: paths(trunk),
    legA: paths(new Map([...legs].filter(([k]) => pair.get(unkey(k)[0]) === 0))),
    legB: paths(new Map([...legs].filter(([k]) => pair.get(unkey(k)[0]) === 1))),
  }
  return { pack: { walk, sprites }, skipped }
}
