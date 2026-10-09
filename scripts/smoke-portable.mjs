import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(root, "artifacts/portable-smoke");
await mkdir(artifactDir, { recursive: true });
const errors = [];
const networkRequests = [];
const browser = await chromium.launch({
  channel: process.env.FRAMEFLOW_BROWSER_CHANNEL || undefined,
});

async function openPortable() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    offline: true,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  await page.goto(pathToFileURL(resolve(root, "打开帧序.html")).href);
  await page.getByRole("heading", { name: "从一段素材开始" }).waitFor();
  return { page, context };
}

async function draw(page, box, width = 960, height = 540) {
  const canvas = page.getByTestId("annotation-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const area = await canvas.boundingBox();
  assert.ok(area, "标注画布应可见");
  const x = area.x + (box.x / width) * area.width;
  const y = area.y + (box.y / height) * area.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + (box.width / width) * area.width,
    y + (box.height / height) * area.height,
    { steps: 8 },
  );
  await page.mouse.up();
}

async function download(page, button, name) {
  const [result] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  assert.equal(await result.failure(), null);
  const path = resolve(artifactDir, name);
  await result.saveAs(path);
  return readFile(path);
}

async function backup(page, name) {
  return JSON.parse(
    await download(page, page.getByRole("button", { name: "保存工程" }), name),
  );
}

async function confirmCandidates(page) {
  await page.getByRole("button", { name: /^确认 \d+ 项$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认候选", exact: true })
    .click();
}

try {
  const { page, context } = await openPortable();
  await page.getByRole("button", { name: "试用示例视频" }).click();
  await page.getByRole("button", { name: "开始标注", exact: true }).click();
  await draw(page, { x: 115, y: 208, width: 110, height: 84 });
  await draw(page, { x: 705, y: 285, width: 110, height: 84 });
  const drawn = await backup(page, "drawn.frameflow.json");
  assert.equal(drawn.annotations.length, 2);
  assert.equal(new Set(drawn.annotations.map((a) => a.trackId)).size, 2);
  assert.equal(new Set(drawn.tracks.map((t) => t.labelId)).size, 1);

  for (const track of drawn.tracks) {
    await page
      .getByLabel("当前目标", { exact: true })
      .selectOption(`${track.id}`);
    const settings = page.locator("details.object-settings");
    if ((await settings.getAttribute("open")) === null)
      await settings.locator("summary").click();
    await page.getByLabel("对象结束帧", { exact: true }).fill("24");
    await page.getByRole("button", { name: "应用区间", exact: true }).click();
  }
  await page.getByLabel("处理与复核范围").selectOption("all");
  await page.getByLabel("确认人工关键帧并继续").click();
  await page.getByLabel("AI 关键帧间隔", { exact: true }).fill("5");
  await page.getByLabel("生成 AI 关键帧", { exact: true }).click();
  await page.getByLabel("生成 AI 关键帧", { exact: true }).waitFor();
  const generated = await backup(page, "ai.frameflow.json");
  for (const track of drawn.tracks) {
    assert.ok(
      generated.annotations.some(
        (a) => a.trackId === track.id && a.source === "assist",
      ),
      `对象 ${track.id} 应有本地引擎生成的候选`,
    );
  }
  await confirmCandidates(page);
  await page.getByLabel("完成 AI 复核并进入补帧").click();
  await page.getByLabel("补帧方式").selectOption("pyramidal-lk");
  await page.getByLabel("生成补帧", { exact: true }).click();
  await page.getByLabel("生成补帧", { exact: true }).waitFor();
  const filled = await backup(page, "filled.frameflow.json");
  for (const track of drawn.tracks) {
    assert.ok(
      filled.annotations.some(
        (a) => a.trackId === track.id && a.source === "tracked",
      ),
      `对象 ${track.id} 应有逐帧光流候选`,
    );
  }
  await confirmCandidates(page);
  const confirmed = await backup(page, "confirmed.frameflow.json");
  assert.ok(confirmed.annotations.every((a) => a.review === "confirmed"));
  await page.screenshot({ path: resolve(artifactDir, "workspace.png") });

  await page.waitForFunction((expected) => {
    const stored = localStorage.getItem("frameflow-project-v1");
    return stored && JSON.parse(stored).annotations.length === expected;
  }, confirmed.annotations.length);
  await page.reload();
  await page.getByRole("button", { name: "继续上次标注" }).click();
  const restored = await backup(page, "reloaded.frameflow.json");
  assert.deepEqual(restored, confirmed, "同一路径刷新应恢复工程");

  await page
    .locator(".heading-actions")
    .getByRole("button", { name: "导出" })
    .click();
  await page.getByRole("button", { name: /^COCO Detection/ }).click();
  await page.getByLabel("同时打包帧图像").check();
  await page.getByRole("button", { name: "下一步：审查", exact: true }).click();
  await page.getByRole("button", { name: "开始审查", exact: true }).click();
  await page.getByRole("button", { name: "重新审查", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回导出", exact: true }).click();
  const archive = await download(
    page,
    page.getByRole("button", { name: "下载 ZIP", exact: true }),
    "coco.zip",
  );
  const files = unzipSync(archive);
  const coco = JSON.parse(strFromU8(files["annotations.json"]));
  const manifest = JSON.parse(strFromU8(files["frameflow-manifest.json"]));
  assert.equal(coco.annotations.length, confirmed.annotations.length);
  assert.deepEqual(manifest.annotations, confirmed.annotations);
  assert.ok(files["audit-report.json"], "ZIP 应包含实际审查报告");
  assert.ok(Object.keys(files).some((path) => /^images\/.*\.jpg$/.test(path)));
  await context.close();

  const fresh = await openPortable();
  await fresh.page
    .getByTestId("project-input")
    .setInputFiles(resolve(artifactDir, "confirmed.frameflow.json"));
  const recovered = await backup(fresh.page, "imported.frameflow.json");
  assert.deepEqual(recovered, confirmed, "新浏览器应可从下载的工程恢复");
  await fresh.context.close();

  const importedZip = await openPortable();
  await importedZip.page.getByRole("button", { name: "试用示例视频" }).click();
  await importedZip.page
    .getByTestId("annotation-input")
    .setInputFiles(resolve(artifactDir, "coco.zip"));
  await importedZip.page
    .getByRole("button", { name: "浏览标注", exact: true })
    .click();
  const roundTrip = await backup(
    importedZip.page,
    "zip-imported.frameflow.json",
  );
  assert.deepEqual(roundTrip.annotations, confirmed.annotations);
  assert.equal(
    await importedZip.page
      .getByTestId("annotation-canvas")
      .locator('g[role="button"]')
      .count(),
    2,
    "回导后第 0 帧应显示两个同类对象",
  );
  await importedZip.context.close();

  const video = await openPortable();
  await video.page
    .getByTestId("media-input")
    .setInputFiles(resolve(root, "tests/fixtures/portable.webm"));
  await video.page.getByLabel("标注帧率", { exact: true }).fill("10");
  await video.page.locator("summary").filter({ hasText: "原视频参数" }).click();
  await video.page.getByLabel("原视频帧率", { exact: true }).fill("30");
  await video.page
    .getByRole("button", { name: "开始标注", exact: true })
    .click();
  await video.page
    .getByText("正在定位帧…", { exact: true })
    .waitFor({ state: "hidden" });
  await draw(video.page, { x: 35, y: 45, width: 50, height: 40 }, 320, 180);
  await video.page.getByLabel("跳转帧号", { exact: true }).fill("3");
  await video.page
    .getByText("正在定位帧…", { exact: true })
    .waitFor({ state: "hidden" });
  await draw(video.page, { x: 45, y: 45, width: 50, height: 40 }, 320, 180);
  const videoProject = await backup(video.page, "video.frameflow.json");
  assert.equal(videoProject.media.kind, "video");
  assert.equal(videoProject.media.fps, 10);
  assert.equal(videoProject.media.sourceFps, 30);
  assert.deepEqual(
    videoProject.annotations.map((a) => a.frame),
    [0, 3],
  );
  await video.page
    .locator(".heading-actions")
    .getByRole("button", { name: "导出" })
    .click();
  await video.page.getByRole("button", { name: /^COCO Detection/ }).click();
  await video.page.getByLabel("同时打包帧图像").check();
  const videoArchive = unzipSync(
    await download(
      video.page,
      video.page.getByRole("button", {
        name: "跳过审查，直接下载",
        exact: true,
      }),
      "video-coco.zip",
    ),
  );
  const videoCoco = JSON.parse(strFromU8(videoArchive["annotations.json"]));
  assert.equal(videoCoco.annotations.length, 2);
  for (const image of videoCoco.images) {
    assert.ok(videoArchive[image.file_name], "每个导出帧应有配对的 JPEG");
    assert.equal(image.width, 320);
    assert.equal(image.height, 180);
  }
  const jpegPath = videoCoco.images[0].file_name;
  await video.context.close();

  const image = await openPortable();
  await image.page.getByTestId("media-input").setInputFiles({
    name: "frame.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(videoArchive[jpegPath]),
  });
  await image.page
    .getByRole("button", { name: "开始标注", exact: true })
    .click();
  await draw(image.page, { x: 35, y: 45, width: 50, height: 40 }, 320, 180);
  const imageProject = await backup(image.page, "image.frameflow.json");
  assert.equal(imageProject.media.kind, "image");
  assert.equal(imageProject.annotations.length, 1);
  await image.context.close();
  assert.deepEqual(errors, [], "页面不应出现 JavaScript 错误");
  assert.deepEqual(networkRequests, [], "离线入口不应请求 CDN、API 或本地服务");
  console.log(
    `离线 file:// 验收通过：同类多对象、人工→AI→光流复核、${confirmed.annotations.length} 个框、JPEG/COCO/审查报告导出、刷新及工程恢复、ZIP 回导、真实 WebM 的 30→10 FPS 标注、JPEG 导入；无网络请求。`,
  );
} finally {
  await browser.close();
}
