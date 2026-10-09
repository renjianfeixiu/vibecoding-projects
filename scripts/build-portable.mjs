import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "打开帧序.html");
const [packageText, favicon, notices] = await Promise.all([
  readFile(resolve(root, "package.json"), "utf8"),
  readFile(resolve(root, "public/favicon.svg")),
  readFile(resolve(root, "docs/THIRD_PARTY_NOTICES.md"), "utf8"),
]);
const { version } = JSON.parse(packageText);
const result = await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: resolve(root, "src/main.tsx"),
      name: "FrameFlowApp",
      formats: ["iife"],
    },
    target: "es2022",
    cssCodeSplit: false,
    minify: "esbuild",
    write: false,
    sourcemap: false,
  },
});
const output = (Array.isArray(result) ? result : [result]).flatMap(
  (item) => item.output,
);
const chunks = output.filter((item) => item.type === "chunk");
if (
  chunks.length !== 1 ||
  !chunks[0].isEntry ||
  chunks[0].imports.length ||
  chunks[0].dynamicImports.length
) {
  throw new Error("便携版必须将所有运行代码打包为一个独立脚本。");
}
const assets = output.filter((item) => item.type === "asset");
if (assets.some((item) => !item.fileName.endsWith(".css"))) {
  throw new Error("便携版存在未内嵌的资源，请先将其合并进 HTML。");
}
const css = assets.map((item) => item.source.toString()).join("\n");
const script = chunks[0].code.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#6155d7" />
    <meta name="frameflow-version" content="${version}" />
    <meta name="description" content="帧序 FrameFlow，本地视频图像标注与质量审查工作台。" />
    <title>帧序 FrameFlow · 标注与审查工作台</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon.toString("base64")}" />
    <style>${css.replace(/<\/style/gi, "<\\/style")}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${script}</script>
    <!-- Third-party notices included in this distribution:
${notices.replaceAll("--", "- -")}
    -->
  </body>
</html>
`;

if (process.argv.includes("--check")) {
  const existing = await readFile(destination, "utf8");
  if (existing !== html) {
    throw new Error(
      "打开帧序.html 与源码不一致，请运行 npm run build 后提交。",
    );
  }
  console.log(`便携版 ${version} 与源码一致。`);
} else {
  await writeFile(destination, html);
  console.log(
    `已生成 打开帧序.html (${version}, ${Buffer.byteLength(html)} bytes)。`,
  );
}
