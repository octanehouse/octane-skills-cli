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
npx @octane-house/skills-cli init compression-tool --name "Octane Compression Tool" --category Visual --dest ./compression-skill
npx @octane-house/skills-cli update --dest .octane/skills
```

The package only downloads Markdown instruction payloads and writes a lock
file. It does not execute install scripts. The GitHub form is the current
public distribution path; the npm form is ready for publication when the
`@octane-house` namespace is authenticated.
