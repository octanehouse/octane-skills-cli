#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_MANIFEST = "https://marcusmfrancis.com/skills/catalog";
const SKILLS_DIRECTORY_API = "https://www.skills.sh/api/search";
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

async function installSkill(catalog, slug) {
  const skill = catalog.skills.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Unknown skill: ${slug}`);
  if (!skill.skillUrl) throw new Error(`Skill has no installer payload: ${slug}`);

  const destination = resolve(option("--dest", ".octane/skills"));
  const response = await fetch(new URL(skill.skillUrl, manifestUrl()));
  if (!response.ok) throw new Error(`Skill request failed: ${response.status}`);
  const skillDirectory = join(destination, slug);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), await response.text(), "utf8");
  await writeLockEntry(destination, { slug, skillUrl: skill.skillUrl, source: "octane" }, catalog);
  console.log(`Installed ${skill.name} → ${join(skillDirectory, "SKILL.md")}`);
}

function sourceParts(value) {
  if (!/^[^/]+\/[^/]+$/.test(value || "")) {
    throw new Error("Source must look like owner/repository");
  }
  return value.split("/");
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

async function initSkill(slug) {
  const safeSlug = validSlug(slug);
  const destination = resolve(option("--dest", "."));
  const name = option("--name", titleFromSlug(safeSlug));
  const category = option("--category", "Visual");
  const description = option("--description", `A reusable Octane Skill for ${name}.`);
  const source = option("--source", "https://github.com/octane-house");
  const skillDirectory = join(destination, "skills", safeSlug);
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
  console.log(`Scaffolded ${name} at ${destination}`);
}

async function fetchExternalSkill(source, skillId) {
  const [owner, repository] = sourceParts(source);
  if (!/^[a-zA-Z0-9._-]+$/.test(skillId || "")) throw new Error("Skill id contains invalid characters");
  const candidates = [
    `https://raw.githubusercontent.com/${owner}/${repository}/main/skills/${skillId}/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${repository}/master/skills/${skillId}/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${repository}/main/${skillId}/SKILL.md`,
  ];
  for (const url of candidates) {
    const response = await fetch(url);
    if (response.ok) return { markdown: await response.text(), url };
  }
  throw new Error(`Could not find skills/${skillId}/SKILL.md in ${source}`);
}

async function addExternalSkill(source, skillId) {
  const destination = resolve(option("--dest", ".octane/skills"));
  const external = await fetchExternalSkill(source, skillId);
  const skillDirectory = join(destination, skillId);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), external.markdown, "utf8");
  await writeLockEntry(destination, { slug: skillId, source: source, sourceUrl: external.url }, undefined);
  console.log(`Installed external source ${source}/${skillId} → ${join(skillDirectory, "SKILL.md")}`);
}

async function searchDirectory(query) {
  const endpoint = new URL(SKILLS_DIRECTORY_API);
  endpoint.searchParams.set("q", query || "");
  endpoint.searchParams.set("limit", String(Math.min(Math.max(Number(option("--limit", 20)) || 20, 1), 100)));
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`skills.sh request failed: ${response.status}`);
  const payload = await response.json();
  for (const skill of payload.skills || []) {
    console.log(`${skill.source}/${skill.skillId}\t${skill.installs ?? 0} installs\t${skill.name}`);
  }
}

async function updateSkills(catalog) {
  const destination = resolve(option("--dest", ".octane/skills"));
  const lock = JSON.parse(await readFile(join(destination, "octane-skills.lock.json"), "utf8"));
  for (const entry of lock.skills || []) {
    if (entry.sourceUrl) {
      const response = await fetch(entry.sourceUrl);
      if (!response.ok) throw new Error(`External skill request failed: ${response.status}`);
      await writeFile(join(destination, entry.slug, "SKILL.md"), await response.text(), "utf8");
    } else {
      await installSkill(catalog, entry.slug);
    }
  }
}

function planSkill(catalog, slug) {
  const skill = catalog.skills.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Unknown skill: ${slug}`);
  console.log(JSON.stringify({
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
  }, null, 2));
}

try {
  const catalog = needsCatalog.has(command) ? await getCatalog() : null;
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Octane Skills CLI

Commands:
  list                         List reviewed Octane Skills
  add <slug>                   Install a reviewed Octane Skill
  add-source <owner/repo>     Install a source skill from GitHub
  plan <slug>                 Print a non-mutating install plan
  search <query>               Search skills.sh for intake candidates
  init <slug>                  Scaffold a new Octane Skill repository
  update                       Refresh installed skills from the lockfile

Options:
  --dest <path>               Destination directory
  --manifest <url>            Catalog endpoint (defaults to marcusmfrancis.com)
`);
  } else if (command === "list") {
    for (const skill of catalog.skills) console.log(`${skill.slug}\t${skill.category}\t${skill.name}`);
  } else if (command === "add") {
    await installSkill(catalog, args[1]);
  } else if (command === "add-source") {
    await addExternalSkill(args[1], option("--skill", args[2]));
  } else if (command === "plan") {
    planSkill(catalog, args[1]);
  } else if (command === "search") {
    await searchDirectory(args.slice(1).filter((arg) => !arg.startsWith("--"))[0] || "");
  } else if (command === "init") {
    await initSkill(args[1]);
  } else if (command === "update") {
    await updateSkills(catalog);
  } else {
    throw new Error(`Unknown command: ${command}. Use list, add, add-source, plan, search, init, or update.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
