# Setting up clawd-bar (instructions for Claude Code)

These steps are written for Claude Code to follow when someone pastes the setup prompt from the README.
A person can follow them by hand too. Step 2 edits `~/.claude/settings.json`; confirm that with the person first.

## 1. Install the plugin

```bash
claude plugin marketplace add DevVaradPatil/clawd-companion
claude plugin install clawd-bar@clawd-companion
```

## 2. Turn on mods

clawd-bar is a mod, a function-hook plugin. That's an early-access feature.
In `~/.claude/settings.json` (on Windows, `%USERPROFILE%\.claude\settings.json`), set this under `"env"`:

```json
"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
```

Keep every other key as it is. If it's already `"1"`, skip this step.

## 3. The mascot art

The art is the free **Claude Mascot Pack** from GetIllustrations:
https://getillustrations.com/illustration-pack/claude-mascot-pack.
Its license doesn't allow redistributing the pack, so each person downloads it themselves.
Don't download it for them.

- **If they gave the path of the unzipped pack**, nothing to do now. After the restart, they run `/clawd pack <that folder>` once.
- **If they haven't downloaded it yet**, tell them to download it and unzip it into **Downloads**, **Desktop** or **Documents**, in a folder whose name contains "claude" or "mascot". The zip's own name does. The mod finds it there on its own.

The first time, the mod compiles the 75 SVGs and caches the result, so later sessions start instantly.

## 4. Finish

Tell the person to fully quit and reopen the Claude desktop app. The bar appears above the prompt in every new session.

`/clawd` shows the bar's status and its commands.

The bar only draws in the **desktop app**, since it's SVG. The terminal CLI shows nothing.

## Uninstall

```bash
claude plugin uninstall clawd-bar@clawd-companion
```
