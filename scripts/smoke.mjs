import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run smoke.");

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => {
  probe.close((error) => (error ? reject(error) : resolve()));
});

const child = spawn(
  process.execPath,
  [npmCli, "start", "--", "--port", String(port)],
  {
    cwd: root,
    env: { ...process.env, BROWSER: "none" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
let exited = false;
const collect = (chunk) => {
  output = (output + chunk.toString()).slice(-8000);
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);
child.on("exit", () => {
  exited = true;
});
child.on("error", collect);

try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      const html = await response.text();
      if (response.ok && html.includes("帧序 FrameFlow")) {
        ready = true;
        break;
      }
    } catch {
      // The server has not finished starting yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`npm start did not become ready.\n${output}`);
  const main = await fetch(`http://127.0.0.1:${port}/src/main.tsx`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!main.ok || !(await main.text()).includes("createRoot"))
    throw new Error("The application entry module could not be served.");
  console.log(`PASS: npm start served FrameFlow at 127.0.0.1:${port}`);
} finally {
  if (child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
}
