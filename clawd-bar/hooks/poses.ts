// Which mascot pose goes with what Claude is doing. Pure: runs under node.
// Every pack sprite is used by at least one list here, and every list names a pack sprite (tests/stage.test.ts).

// The Claude Mascot Pack's 75 file names (no art: names only), to check a downloaded pack against.
export const PACK_NAMES = [
  'angry-at-laptop', 'angry-pixel-coffee', 'angry-powerful-lightning', 'api-success-pixel', 'artboard-24cla',
  'artboard-24cla2', 'artboard-24cla3', 'artboard-25cla', 'artboard-25cla2', 'artboard-25cla3', 'artboard-2cla',
  'artboard-2cla2', 'artboard-2cla3', 'artboard-3cla', 'artboard-3cla2', 'artboard-3cla3', 'artboard-4cla',
  'artboard-4cla2', 'artboard-4cla3', 'baking-steaming-pie', 'broken-heart-sad', 'building-colorful-blocks',
  'confusion-spiral-pixel', 'crying-sad-reaction', 'data-blocks-pixel', 'debugging-system-bugs',
  'developer-pair-programming-scene', 'disconnected-plug-pixel', 'dizzy-failed-state', 'error-state-pixel',
  'examining-green-globe', 'failed-process-error', 'fast-performance-trail', 'fine-under-pressure',
  'growing-pixel-nature', 'happy-pixel-celebrating', 'holding-ancient-scroll', 'holding-green-leaf',
  'idea-lightbulb-pixel', 'in-constant-loop', 'in-glowing-aura', 'infrastructure-server-stacks', 'it-depends-sign',
  'lab-science-testing', 'lifting-heavy-barbell', 'love-cloud-pixel', 'malware-detection-window',
  'managing-server-rack', 'marking-critical-error', 'multi-window-workflow', 'nature-growth-mushrooms',
  'planting-small-trees', 'processing-logic-symbols', 'professional-documentation-audit', 'reading-data-document',
  'refresh-sync-pixel', 'repairing-with-tools', 'reviewing-long-data-log', 'rocket-launch-success',
  'secure-access-padlock', 'server-stack-pixel', 'sleeping-soundly', 'stealth-ninja-security',
  'success-achievement-milestone', 'system-error-alert', 'system-monitoring-dashboard', 'thinking-in-code',
  'thinking-pixel-bubble', 'tracking-multiple-locations', 'trending-up-pixel', 'user-profile-settings',
  'visualizing-tree-data', 'welcome-pixel-banner', 'with-success-checkmark', 'writing-software-code',
]

export type Mood = 'think' | 'read' | 'search' | 'edit' | 'bash' | 'test' | 'git' | 'build' | 'clean' | 'server' | 'web' | 'agent' | 'mcp' | 'plan' | 'ask' | 'skill' | 'secure' | 'settings' | 'long'
export type Cue = 'hello' | 'done' | 'error' | 'mcpError' | 'fail' | 'denied' | 'aborted' | 'compact' | 'pressure' | 'limit' | 'click' | 'hobby' | 'sleep'

export const WORK: Record<Mood, string[]> = {
  think: ['thinking-pixel-bubble', 'thinking-in-code', 'idea-lightbulb-pixel', 'artboard-4cla', 'processing-logic-symbols'],
  read: ['reading-data-document', 'holding-ancient-scroll', 'reviewing-long-data-log', 'professional-documentation-audit'],
  search: ['examining-green-globe', 'tracking-multiple-locations', 'visualizing-tree-data', 'data-blocks-pixel'],
  edit: ['writing-software-code', 'artboard-2cla', 'building-colorful-blocks', 'processing-logic-symbols'],
  bash: ['system-monitoring-dashboard', 'repairing-with-tools', 'managing-server-rack', 'artboard-4cla3'],
  test: ['lab-science-testing', 'debugging-system-bugs'],
  git: ['visualizing-tree-data', 'multi-window-workflow'],
  build: ['building-colorful-blocks', 'repairing-with-tools', 'infrastructure-server-stacks'],
  clean: ['artboard-25cla3'],
  server: ['managing-server-rack', 'server-stack-pixel', 'infrastructure-server-stacks'],
  web: ['examining-green-globe', 'api-success-pixel', 'tracking-multiple-locations'],
  agent: ['developer-pair-programming-scene', 'multi-window-workflow'],
  mcp: ['api-success-pixel', 'data-blocks-pixel', 'system-monitoring-dashboard'],
  plan: ['professional-documentation-audit', 'holding-ancient-scroll', 'reviewing-long-data-log'],
  ask: ['it-depends-sign'],
  skill: ['artboard-2cla3', 'stealth-ninja-security', 'in-glowing-aura'],
  secure: ['secure-access-padlock', 'malware-detection-window', 'artboard-24cla3', 'stealth-ninja-security'],
  settings: ['user-profile-settings'],
  long: ['lifting-heavy-barbell', 'in-constant-loop', 'fine-under-pressure', 'artboard-4cla3', 'fast-performance-trail'],
}

export const CUES: Record<Cue, string[]> = {
  hello: ['welcome-pixel-banner', 'artboard-3cla'],
  done: ['with-success-checkmark', 'success-achievement-milestone', 'rocket-launch-success', 'happy-pixel-celebrating', 'trending-up-pixel', 'artboard-3cla2'],
  error: ['error-state-pixel', 'failed-process-error', 'marking-critical-error', 'system-error-alert', 'debugging-system-bugs', 'artboard-25cla2', 'confusion-spiral-pixel'],
  mcpError: ['disconnected-plug-pixel'],
  fail: ['dizzy-failed-state', 'angry-at-laptop', 'disconnected-plug-pixel', 'artboard-2cla2'],
  denied: ['secure-access-padlock', 'artboard-2cla2'],
  aborted: ['broken-heart-sad', 'crying-sad-reaction', 'artboard-24cla2'],
  compact: ['refresh-sync-pixel'],
  pressure: ['fine-under-pressure', 'angry-pixel-coffee'],
  limit: ['angry-pixel-coffee', 'angry-powerful-lightning'],
  click: ['love-cloud-pixel', 'happy-pixel-celebrating', 'artboard-3cla2', 'in-glowing-aura', 'artboard-4cla2', 'angry-powerful-lightning', 'artboard-3cla3', 'artboard-24cla3', 'artboard-3cla'],
  hobby: ['artboard-24cla', 'planting-small-trees', 'holding-green-leaf', 'nature-growth-mushrooms', 'growing-pixel-nature', 'baking-steaming-pie', 'artboard-25cla', 'lifting-heavy-barbell'],
  sleep: ['sleeping-soundly'],
}

export const SAY: Partial<Record<Cue, string[]>> = {
  hello: ['hi!', 'hello!', 'ready'],
  error: ['oops', 'hmm…', 'uh-oh'],
  mcpError: ['unplugged?'],
  fail: ['ugh', 'that broke'],
  denied: ['not allowed'],
  aborted: ['oh…', 'stopped'],
  compact: ['tidying up'],
  pressure: ['getting full'],
  limit: ['near the limit!'],
  click: ['hi!', '♥', 'hehe', 'boop!', 'yes?', 'hey!', '!!'],
}

type Input = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const clip = (t: string, n = 26) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const SECURE = /(secret|password|passwd|token|credential|\.env\b|auth|security|vuln|ssh-key|id_rsa)/i

// What a tool call is (mood) and the few words a hover over the mascot says about it.
export const classify = (tool: string, e: Input): { mood: Mood; label: string } => {
  const file = str(e.file_path) || str(e.notebook_path) || str(e.path)
  const blob = `${file} ${str(e.command)} ${str(e.pattern)}`
  if (/^(Read|NotebookRead)$/.test(tool)) return { mood: SECURE.test(blob) ? 'secure' : 'read', label: `reading ${clip(base(file))}` }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const mood = /settings(\.local)?\.json$|config/i.test(file) ? 'settings' : SECURE.test(blob) ? 'secure' : 'edit'
    return { mood, label: `${tool === 'Write' ? 'writing' : 'editing'} ${clip(base(file))}` }
  }
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(tool)) return { mood: 'search', label: `searching ${clip(str(e.pattern) || str(e.query) || base(file))}` }
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const cmd = str(e.command).trim()
    const label = `$ ${clip(cmd.replace(/\s+/g, ' '), 24)}`
    const mood: Mood =
      /\b(test|pytest|jest|vitest|mocha|check|lint|tsc|validate)\b/.test(cmd) ? 'test'
        : /^\s*git\b|\bgh\s/.test(cmd) ? 'git'
          : /\b(install|build|make|cargo|compile|bundle|pip|npm (i|ci)|yarn|pnpm)\b/.test(cmd) ? 'build'
            : /\b(rm|del|Remove-Item|clean|prune|rmdir)\b/.test(cmd) ? 'clean'
              : /\b(ssh|scp|docker|kubectl|sbatch|squeue|deploy|curl|server|serve)\b/.test(cmd) ? 'server'
                : SECURE.test(cmd) ? 'secure' : 'bash'
    return { mood, label }
  }
  if (/^Web(Fetch|Search)$/.test(tool)) return { mood: 'web', label: tool === 'WebSearch' ? `searching "${clip(str(e.query), 20)}"` : `fetching ${clip(str(e.url).replace(/^https?:\/\//, ''), 22)}` }
  if (/^(Agent|Task)$/.test(tool)) return { mood: 'agent', label: `agent: ${clip(str(e.description) || 'helper', 20)}` }
  if (/^(TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode)$/.test(tool)) return { mood: 'plan', label: 'planning' }
  if (tool === 'AskUserQuestion') return { mood: 'ask', label: 'asking you' }
  if (tool === 'Skill') return { mood: 'skill', label: `skill: ${clip(str(e.skill), 20)}` }
  if (/Browser|chrome|computer-use/i.test(tool)) return { mood: 'web', label: 'using the browser' }
  if (tool.startsWith('mcp__')) return { mood: 'mcp', label: clip(tool.split('__').slice(1).join(' · '), 26) }
  return { mood: 'think', label: clip(tool.toLowerCase(), 26) }
}
