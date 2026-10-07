// Scene coordinates are used only to paint pixels. Assist plugins receive ImageData.
export function drawDemo(
  ctx: CanvasRenderingContext2D,
  frame: number,
  fps = 30,
) {
  const t = frame / fps;
  ctx.clearRect(0, 0, 960, 540);
  ctx.fillStyle = "#e7e9e5";
  ctx.fillRect(0, 0, 960, 540);
  ctx.strokeStyle = "#dce0db";
  ctx.lineWidth = 1;
  for (let x = 0; x < 960; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 540);
    ctx.stroke();
  }
  for (let y = 0; y < 540; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(960, y);
    ctx.stroke();
  }
  const shelf = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = "#ced4ce";
    ctx.fillRect(x + 5, y + 7, w, h);
    ctx.fillStyle = "#7e9184";
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < w; k += 47) {
      ctx.fillStyle = k % 94 === 0 ? "#c7b8a0" : "#b6a58e";
      ctx.fillRect(x + k + 7, y + 8, 32, h - 16);
      ctx.strokeStyle = "#aa9b86";
      ctx.strokeRect(x + k + 7, y + 8, 32, h - 16);
      ctx.fillStyle = "#e1d7c4";
      ctx.fillRect(x + k + 20, y + 8, 6, h - 16);
    }
  };
  shelf(65, 70, 235, 90);
  shelf(380, 70, 235, 90);
  shelf(700, 70, 188, 90);
  shelf(65, 385, 235, 85);
  shelf(380, 385, 235, 85);
  shelf(700, 385, 188, 85);
  ctx.setLineDash([16, 12]);
  ctx.strokeStyle = "#b9c0b8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(35, 278);
  ctx.lineTo(920, 278);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "600 12px sans-serif";
  ctx.fillStyle = "#819184";
  ctx.fillText("AISLE A  →", 68, 208);
  ctx.fillText("AISLE B  ←", 735, 346);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8c968e";
  ctx.fillText("WAREHOUSE / CAMERA 02", 35, 34);
  ctx.fillText("FRAMEFLOW · SYNTHETIC SAMPLE", 35, 518);
  const robot = (x: number, y: number, color: string, id: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#00000012";
    ctx.beginPath();
    ctx.ellipse(3, 10, 48, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#313a42";
    ctx.fillRect(-44, -20, 14, 40);
    ctx.fillRect(30, -20, 14, 40);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-38, -27, 76, 54, 12);
    ctx.fill();
    ctx.fillStyle = "#f9faf7";
    ctx.beginPath();
    ctx.roundRect(-25, -16, 43, 32, 6);
    ctx.fill();
    ctx.fillStyle = "#424b55";
    ctx.fillRect(-19, -11, 12, 22);
    ctx.fillStyle = "#d6dbe0";
    ctx.fillRect(-2, -9, 14, 18);
    ctx.fillStyle = "#f2d36b";
    ctx.beginPath();
    ctx.arc(28, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a5360";
    ctx.font = "bold 9px monospace";
    ctx.fillText(id, -4, 3);
    ctx.restore();
  };
  robot(170 + t * 49, 245 + Math.sin(t * 0.55) * 18, "#8d8bdb", "01");
  robot(760 - t * 36, 319 + Math.sin(t * 0.7 + 1) * 10, "#75aaa0", "02");
}
export function demoImage(frame: number, fps = 30): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  drawDemo(ctx, frame, fps);
  return ctx.getImageData(0, 0, 960, 540);
}
