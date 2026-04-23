# Machine config snapshots

Versioned copies of MCP and Cursor user settings from this machine. Env values use `${VAR}` placeholders only; keep secrets in `~/.env.keys` or provider dashboards.

## Restore MCP (and Cursor symlink)

From the repo root:

```bash
bash scripts/apply-machine-config.sh
```

## Cursor settings

`cursor-user-settings.json` is a full export for diffing or manual merge into `~/Library/Application Support/Cursor/User/settings.json`. Prefer merging selective keys in the editor over blind overwrite.

## zsh PATH

Ensure Homebrew precedes user bins (matches live `~/.zshrc`):

```sh
export PATH="/opt/homebrew/bin:$HOME/bin:$HOME/go/bin:$HOME/.local/bin:$HOME/Library/Python/3.9/bin:$PATH"
```

Place this in the Path block after the zsh-only guard at the top of `~/.zshrc`.
