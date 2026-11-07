# Managed settings on Zeus's Mac (#35)

Managed settings sit above every other Claude Code setting on this Mac: no project, user or `--settings` file can
undo them. LetZeusPost uses them for one thing: **no session can switch to "bypass permissions"**, which would skip
every deny rule. The same line is in `.claude/settings.json` and `.claude/builder/settings.json`; managed settings
make it stick even if those files were changed.

This applies to **every** Claude Code session on the Mac, the editz studio included. It doesn't touch auto mode or
normal permission prompts; it only removes bypass mode.

## Install (needs an administrator password, once)

```sh
sudo mkdir -p "/Library/Application Support/ClaudeCode"
sudo tee "/Library/Application Support/ClaudeCode/managed-settings.json" >/dev/null <<'JSON'
{
  "permissions": {
    "disableBypassPermissionsMode": "disable"
  }
}
JSON
```

## Check

Start `claude` anywhere and run `/status` (or try `claude --permission-mode bypassPermissions`): bypass mode is
refused.

## Undo

```sh
sudo rm "/Library/Application Support/ClaudeCode/managed-settings.json"
```

Key and value checked against code.claude.com on 2026-11-07 (`permissions.disableBypassPermissionsMode: "disable"`).
