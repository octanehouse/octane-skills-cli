# Octane Skills CLI

The small installer boundary for reviewed public Octane Skills.

```bash
# Published-package form (once the npm namespace is authenticated)
npx @octane-house/skills-cli list

# No npm account required: run the public GitHub package directly
npx --yes github:octanehouse/octane-skills-cli list
npx @octane-house/skills-cli add shader-gradient --dest .octane/skills
npx @octane-house/skills-cli search shader --limit 20
npx @octane-house/skills-cli add-source cloudai-x/threejs-skills --skill threejs-shaders --dest .octane/skills
npx --yes github:octanehouse/octane-skills-cli add-url https://github.com/anthropics/skills/tree/main/skills/frontend-design --skill frontend-design --dest .octane/skills
npx @octane-house/skills-cli init compression-tool --name "Octane Compression Tool" --category Visual --dest ./compression-skill
npx @octane-house/skills-cli update --dest .octane/skills

# MCP connection handoff
npx --yes github:octanehouse/octane-skills-cli mcp config

# Agent-facing contract
npx @octane-house/skills-cli schema
npx @octane-house/skills-cli add shader-gradient --dry-run --format json
npm test
```

The package only downloads Markdown instruction payloads and writes a lock
file. It does not execute install scripts. The GitHub form is the current
public distribution path; the npm form is release-ready.

`mcp config` is read-only. It prints the Streamable HTTP endpoint, a Claude
Code command, and a JSON `mcpServers` block. The public endpoint exposes
catalog discovery and scaffold planning; write actions remain authenticated
and explicitly confirmed by the server.

For the one-time npm release setup, authenticate to npm and register the
repository's GitHub Actions workflow as a trusted publisher:

```bash
npm trust github @octane-house/skills-cli \
  --repository octanehouse/octane-skills-cli \
  --file publish.yml \
  --allow-publish \
  --yes
```

After that, publishing is handled by GitHub OIDC from a public release. The
workflow does not require a long-lived `NPM_TOKEN`.

`add-source` accepts `owner/repository`, a GitHub tree/blob URL, and an optional
`--branch`. It resolves `skills/<id>/SKILL.md`, `<id>/SKILL.md`, or a root
`SKILL.md`. `add-url` accepts a direct Markdown URL or the same GitHub tree/blob
form. Both commands save the resolved Markdown source URL in the lock file.

When stdout is a terminal, commands use compact human-readable tables. When
stdout is redirected or `--format json` is supplied, every result uses a
versioned envelope:

```json
{"ok":true,"data":{},"meta":{"schema_version":"1.0.0","cli_version":"0.2.0"}}
```

Validation failures return exit code `3`; runtime or network failures return
exit code `1`. Mutating commands support `--dry-run` and never execute scripts
from an imported skill.
