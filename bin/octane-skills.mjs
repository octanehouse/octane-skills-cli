#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_MANIFEST = "https://marcusmfrancis.com/skills/catalog";
const SKILLS_DIRECTORY_API = "https://www.skills.sh/api/search";
const CLI_VERSION = "0.2.0";
const SCHEMA_VERSION = "1.0.0";
const args = process.argv.slice(2);
const command = args[0] || "list";
const needsCatalog = new Set(["list", "add", "plan", "update"]);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function manifestUrl() {
  return option("--manifest", process.env.OCTANE_SKILLS_MANIFEST || DEFAULT_MANIFEST);
}

function outputFormat() {
  const requested = option("--format", args.includes("--json") ? "json" : "");
  if (requested && requested !== "json" && requested !== "table") {
    throw new Error("--format must be json or table");
  }
  return requested || (process.stdout.isTTY ? "table" : "json");
}

function metadata() {
  return { schema_version: SCHEMA_VERSION, cli_version: CLI_VERSION };
}

function emitSuccess(data, human) {
  if (outputFormat() === "json") {
    process.stdout.write(`${JSON.stringify({ ok: true, data, meta: metadata() })}\n`);
    return;
  }
  process.stdout.write(`${human}\n`);
}

function emitError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const validation = /invalid|must |required|unknown skill|use --skill|source must|skill id/i.test(message);
  const payload = {
    ok: false,
    error: {
      code: validation ? "validation_error" : "runtime_error",
      message,
      retryable: !validation,
    },
    meta: metadata(),
  };
  if (outputFormat() === "json") {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = validation ? 3 : 1;
}

const SCHEMA = {
  schema_version: SCHEMA_VERSION,
  cli_version: CLI_VERSION,
  commands: {
    list: { mutates: false, output: "catalog" },
    add: { mutates: true, supports: ["--dry-run"], output: "install" },
    "add-source": { mutates: true, supports: ["--dry-run"], output: "install" },
    "add-url": { mutates: true, supports: ["--dry-run"], output: "install" },
    plan: { mutates: false, output: "install_plan" },
    search: { mutates: false, output: "directory_results" },
    init: { mutates: true, supports: ["--dry-run"], output: "scaffold" },
    update: { mutates: true, supports: ["--dry-run"], output: "update" },
    mcp: { mutates: false, output: "mcp_config" },
  },
};

async function getCatalog() {
  const response = await fetch(manifestUrl());
  if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
  return response.json();
}

async function writeLockEntry(destination, entry, catalog) {
  const lockPath = join(destination, "octane-skills.lock.json");
  let lock = { schema: catalog?.schema || "https://octane.house/schemas/skills/v1.json", version: catalog?.version || 2, skills: [] };
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    // First install creates the lock.
  }
  lock.skills = [...(lock.skills || []).filter((item) => item.slug !== entry.slug), entry];
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function installSkill(catalog, slug, { dryRun = false } = {}) {
  const skill = catalog.skills.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Unknown skill: ${slug}`);
  if (!skill.skillUrl) throw new Error(`Skill has no installer payload: ${slug}`);

  const destination = resolve(option("--dest", ".octane/skills"));
  const skillDirectory = join(destination, slug);
  const writes = [
    join(skillDirectory, "SKILL.md"),
    join(destination, "octane-skills.lock.json"),
  ];
  if (dryRun) {
    return {
      action: "skills/add",
      slug,
      name: skill.name,
      category: skill.category,
      source: skill.source,
      repositoryUrl: skill.repositoryUrl ?? null,
      skillUrl: new URL(skill.skillUrl, manifestUrl()).toString(),
      writes,
      executesScripts: false,
      mutationPerformed: false,
    };
  }
  const response = await fetch(new URL(skill.skillUrl, manifestUrl()));
  if (!response.ok) throw new Error(`Skill request failed: ${response.status}`);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), await response.text(), "utf8");
  await writeLockEntry(destination, { slug, skillUrl: skill.skillUrl, source: "octane" }, catalog);
  return {
    action: "skills/add",
    slug,
    name: skill.name,
    destination: join(skillDirectory, "SKILL.md"),
    writes,
    executesScripts: false,
    mutationPerformed: true,
  };
}

function sourceParts(value) {
  if (/^[^/]+\/[^/]+$/.test(value || "")) return value.split("/");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error();
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error();
    return parts.slice(0, 2);
  } catch {
    throw new Error("Source must look like owner/repository or a GitHub URL");
  }
}

function validSlug(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || "")) {
    throw new Error("Skill slug must use lowercase kebab-case");
  }
  return value;
}

function titleFromSlug(slug) {
  return slug.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

async function createFileOnce(filePath, content) {
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
}

async function initSkill(slug, { dryRun = false } = {}) {
  const safeSlug = validSlug(slug);
  const destination = resolve(option("--dest", "."));
  const name = option("--name", titleFromSlug(safeSlug));
  const category = option("--category", "Visual");
  const description = option("--description", `A reusable Octane Skill for ${name}.`);
  const source = option("--source", "https://github.com/octanehouse");
  const skillDirectory = join(destination, "skills", safeSlug);
  const writes = [
    join(skillDirectory, "SKILL.md"),
    join(destination, "octane-skill.json"),
    join(destination, "README.md"),
  ];
  if (dryRun) {
    return {
      action: "skills/init",
      slug: safeSlug,
      name,
      category,
      destination,
      writes,
      executesScripts: false,
      mutationPerformed: false,
    };
  }
  await mkdir(skillDirectory, { recursive: true });
  await createFileOnce(join(skillDirectory, "SKILL.md"), `---
name: ${name}
description: ${description}
category: ${category}
source: ${source}
---

# ${name}

${description}

## Usage

Describe when an agent should use this skill and the expected inputs and outputs.

## Integration

Add the installation and integration steps here. Keep this file instruction-only;
do not execute scripts from the skill automatically.
`);
  await createFileOnce(join(destination, "octane-skill.json"), `${JSON.stringify({
    schema: "https://octane.house/schemas/skills/v1.json",
    slug: safeSlug,
    name,
    category,
    description,
    source,
  }, null, 2)}\n`);
  await createFileOnce(join(destination, "README.md"), `# ${name}

Octane Skill: **${name}**

Install the instruction file from \`skills/${safeSlug}/SKILL.md\` after reviewing the source.
`);
  return {
    action: "skills/init",
    slug: safeSlug,
    name,
    category,
    destination,
    writes,
    executesScripts: false,
    mutationPerformed: true,
  };
}

function githubSkillUrl(value, skillId) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repository, kind, ref, ...path] = parts;
  if (kind !== "tree" && kind !== "blob") return null;
  const sourcePath = path.length ? path : ["skills", skillId];
  const markdownPath = sourcePath.at(-1) === "SKILL.md" ? sourcePath : [...sourcePath, "SKILL.md"];
  return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${markdownPath.join("/")}`;
}

function directSkillUrl(value, skillId) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    if (url.hostname === "raw.githubusercontent.com") return url.toString();
    if (url.hostname === "github.com") return githubSkillUrl(value, skillId);
    if (url.pathname.endsWith(".md")) return url.toString();
  } catch {
    return null;
  }
  return null;
}

async function fetchMarkdown(url) {
  const response = await fetch(url);
  if (response.ok) return { markdown: await response.text(), url };
  return null;
}

async function fetchExternalSkill(source, skillId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(skillId || "")) throw new Error("Skill id contains invalid characters");
  const explicitUrl = directSkillUrl(source, skillId);
  if (explicitUrl) {
    const result = await fetchMarkdown(explicitUrl);
    if (result) return result;
    throw new Error(`Could not fetch a Markdown skill from ${source}`);
  }
  const [owner, repository] = sourceParts(source);
  const branch = option("--branch", "");
  const branches = branch ? [branch] : ["main", "master"];
  const candidates = [
    ...branches.flatMap((ref) => [
      `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/skills/${skillId}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${skillId}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/SKILL.md`,
    ]),
  ];
  for (const url of candidates) {
    const result = await fetchMarkdown(url);
    if (result) return result;
  }
  throw new Error(`Could not find a Markdown skill for ${skillId} in ${source}`);
}

async function addExternalSkill(source, skillId, { dryRun = false } = {}) {
  if (!source) throw new Error("A source owner/repository or URL is required");
  if (!skillId) throw new Error("Use --skill <slug> to select the skill to install");
  const destination = resolve(option("--dest", ".octane/skills"));
  const skillDirectory = join(destination, skillId);
  const external = await fetchExternalSkill(source, skillId);
  const writes = [
    join(skillDirectory, "SKILL.md"),
    join(destination, "octane-skills.lock.json"),
  ];
  if (dryRun) {
    return {
      action: "skills/add-source",
      slug: skillId,
      source,
      sourceUrl: external.url,
      writes,
      executesScripts: false,
      mutationPerformed: false,
    };
  }
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), external.markdown, "utf8");
  await writeLockEntry(destination, { slug: skillId, source: source, sourceUrl: external.url }, undefined);
  return {
    action: "skills/add-source",
    slug: skillId,
    source,
    sourceUrl: external.url,
    destination: join(skillDirectory, "SKILL.md"),
    writes,
    executesScripts: false,
    mutationPerformed: true,
  };
}

async function searchDirectory(query) {
  const endpoint = new URL(SKILLS_DIRECTORY_API);
  endpoint.searchParams.set("q", query || "");
  endpoint.searchParams.set("limit", String(Math.min(Math.max(Number(option("--limit", 20)) || 20, 1), 100)));
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`skills.sh request failed: ${response.status}`);
  const payload = await response.json();
  return (payload.skills || []).map((skill) => {
    const source = skill.source || "unknown/unknown";
    const skillId = skill.skillId || skill.name || "skill";
    return {
      source,
      skillId,
      installs: skill.installs ?? 0,
      name: skill.name || skillId,
      reviewed: false,
      sourceUrl: `https://github.com/${source}`,
      directoryUrl: `https://www.skills.sh/${source}/${skillId}`,
      installCommand: `npx --yes github:octanehouse/octane-skills-cli add-source ${source} --skill ${skillId} --dest .octane/skills`,
    };
  });
}

async function updateSkills(catalog, { dryRun = false } = {}) {
  const destination = resolve(option("--dest", ".octane/skills"));
  const lock = JSON.parse(await readFile(join(destination, "octane-skills.lock.json"), "utf8"));
  const updates = [];
  for (const entry of lock.skills || []) {
    updates.push({ slug: entry.slug, source: entry.source || "octane" });
    if (dryRun) continue;
    if (entry.sourceUrl) {
      const response = await fetch(entry.sourceUrl);
      if (!response.ok) throw new Error(`External skill request failed: ${response.status}`);
      await writeFile(join(destination, entry.slug, "SKILL.md"), await response.text(), "utf8");
    } else {
      await installSkill(catalog, entry.slug);
    }
  }
  return {
    action: "skills/update",
    destination,
    skills: updates,
    mutationPerformed: !dryRun,
  };
}

function planSkill(catalog, slug) {
  const skill = catalog.skills.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Unknown skill: ${slug}`);
  return {
    action: "skills/add",
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    source: skill.source,
    repositoryUrl: skill.repositoryUrl ?? null,
    skillUrl: new URL(skill.skillUrl, manifestUrl()).toString(),
    installCommand: skill.installCommand,
    writes: [`.octane/skills/${skill.slug}/SKILL.md`, ".octane/skills/octane-skills.lock.json"],
    executesScripts: false,
    requiresConfirmation: true,
  };
}

function mcpConfig() {
  const endpoint = option("--url", DEFAULT_MANIFEST.replace("/skills/catalog", "/mcp"));
  const name = option("--name", "octane-house");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("MCP endpoint must be a valid http or https URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MCP endpoint must use http or https");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error("MCP server name must use lowercase letters, numbers, and hyphens");
  }
  const claudeCommand = `claude mcp add --transport http ${name} ${endpoint}`;
  const config = { mcpServers: { [name]: { url: endpoint } } };
  return {
    action: "mcp/config",
    name,
    endpoint,
    transport: "streamable-http",
    readOnlyUntilConfigured: true,
    requiresAuthForWrites: true,
    claudeCommand,
    config,
  };
}

try {
  const catalog = needsCatalog.has(command) ? await getCatalog() : null;
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`Octane Skills CLI

Commands:
  list                         List reviewed Octane Skills
  add <slug>                   Install a reviewed Octane Skill
  add-source <owner/repo>     Install a source skill from GitHub
  add-url <url>                Install a Markdown or GitHub tree/blob skill URL
  plan <slug>                 Print a non-mutating install plan
  search <query>               Search skills.sh for intake candidates
  init <slug>                  Scaffold a new Octane Skill repository
  update                       Refresh installed skills from the lockfile
  mcp config                   Print an MCP client command and JSON config

Options:
  --dest <path>               Destination directory
  --skill <slug>              Skill directory/id for source and URL imports
  --branch <name>             Git branch for owner/repository imports
  --manifest <url>            Catalog endpoint (defaults to marcusmfrancis.com)
  --format json|table          Stable JSON envelopes or human-readable tables
  --dry-run                   Preview a write without changing the filesystem
  schema                      Print the versioned command schema
`);
  } else if (command === "schema") {
    process.stdout.write(`${JSON.stringify(SCHEMA, null, 2)}\n`);
  } else if (command === "mcp") {
    if (args[1] && args[1] !== "config") {
      throw new Error(`Unknown mcp action: ${args[1]}. Use mcp config.`);
    }
    const data = mcpConfig();
    emitSuccess(data, `${data.claudeCommand}\n${JSON.stringify(data.config, null, 2)}`);
  } else if (command === "list") {
    const data = { skills: catalog.skills.map(({ slug, category, name }) => ({ slug, category, name })), count: catalog.skills.length };
    emitSuccess(data, data.skills.map((skill) => `${skill.slug}\t${skill.category}\t${skill.name}`).join("\n"));
  } else if (command === "add") {
    const data = await installSkill(catalog, args[1], { dryRun: args.includes("--dry-run") });
    emitSuccess(data, data.mutationPerformed ? `Installed ${data.name} → ${data.destination}` : `Plan: ${data.slug} → ${data.writes.join(", ")}`);
  } else if (command === "add-source") {
    const data = await addExternalSkill(args[1], option("--skill", args[2]), { dryRun: args.includes("--dry-run") });
    emitSuccess(data, data.mutationPerformed ? `Installed external source ${data.source} (${data.slug}) → ${data.destination}` : `Plan: ${data.slug} → ${data.writes.join(", ")}`);
  } else if (command === "add-url") {
    const data = await addExternalSkill(args[1], option("--skill", args[2]), { dryRun: args.includes("--dry-run") });
    emitSuccess(data, data.mutationPerformed ? `Installed external source ${data.source} (${data.slug}) → ${data.destination}` : `Plan: ${data.slug} → ${data.writes.join(", ")}`);
  } else if (command === "plan") {
    const data = planSkill(catalog, args[1]);
    emitSuccess(data, JSON.stringify(data, null, 2));
  } else if (command === "search") {
    const query = args.slice(1).filter((arg) => !arg.startsWith("--"))[0] || "";
    const data = await searchDirectory(query);
    emitSuccess({ query, skills: data, count: data.length }, data.map((skill) => `${skill.source}/${skill.skillId}\t${skill.installs} installs\t${skill.name}`).join("\n"));
  } else if (command === "init") {
    const data = await initSkill(args[1], { dryRun: args.includes("--dry-run") });
    emitSuccess(data, data.mutationPerformed ? `Scaffolded ${data.name} at ${data.destination}` : `Plan: scaffold ${data.name} at ${data.destination}`);
  } else if (command === "update") {
    const data = await updateSkills(catalog, { dryRun: args.includes("--dry-run") });
    emitSuccess(data, `${data.mutationPerformed ? "Updated" : "Plan:"} ${data.skills.length} skill${data.skills.length === 1 ? "" : "s"}`);
  } else {
    throw new Error(`Unknown command: ${command}. Use list, add, add-source, add-url, plan, search, init, or update.`);
  }
} catch (error) {
  emitError(error);
}
