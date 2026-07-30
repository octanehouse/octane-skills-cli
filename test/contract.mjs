import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const bin = fileURLToPath(new URL("../bin/octane-skills.mjs", import.meta.url));

function run(args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const schema = await run(["schema"]);
assert(schema.code === 0, "schema command failed");
const schemaPayload = JSON.parse(schema.stdout);
assert(schemaPayload.schema_version === "1.0.0", "schema version drifted");
assert(schemaPayload.commands.add.supports.includes("--dry-run"), "add lost dry-run support");

const dryRunDirectory = await mkdtemp(join(tmpdir(), "octane-cli-contract-"));
const dryRun = await run(["init", "contract-skill", "--dest", dryRunDirectory, "--dry-run", "--format", "json"]);
assert(dryRun.code === 0, "init dry-run failed");
const dryRunPayload = JSON.parse(dryRun.stdout);
assert(dryRunPayload.ok === true, "dry-run did not return a success envelope");
assert(dryRunPayload.data.mutationPerformed === false, "dry-run claims it mutated state");
assert((await readdir(dryRunDirectory)).length === 0, "dry-run wrote to the filesystem");

const invalid = await run(["add", "not-a-real-skill", "--format", "json"]);
assert(invalid.code === 3, `validation exit code changed: ${invalid.code}`);
const invalidPayload = JSON.parse(invalid.stdout);
assert(invalidPayload.ok === false, "validation failure returned success");
assert(invalidPayload.error.code === "validation_error", "validation error code changed");
assert(invalidPayload.error.retryable === false, "validation failure became retryable");

console.log("Octane Skills CLI contract tests passed");
