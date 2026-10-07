import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(join(root, "tests"))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join("tests", name));
if (!files.length) {
  console.error("No test files found.");
  process.exit(1);
}
// Pass explicit paths: Windows cmd.exe does not expand shell globs like bash.
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { cwd: root, stdio: "inherit", shell: false },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
