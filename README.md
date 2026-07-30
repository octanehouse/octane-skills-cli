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
```

The package only downloads Markdown instruction payloads and writes a lock
file. It does not execute install scripts. The GitHub form is the current
public distribution path; the npm form is release-ready. npm Trusted
Publishing can be configured for the `publish.yml` GitHub workflow so the
release does not need a long-lived npm token.

`add-source` accepts `owner/repository`, a GitHub tree/blob URL, and an optional
`--branch`. It resolves `skills/<id>/SKILL.md`, `<id>/SKILL.md`, or a root
`SKILL.md`. `add-url` accepts a direct Markdown URL or the same GitHub tree/blob
form. Both commands save the resolved Markdown source URL in the lock file.
