import { Aperture } from "./icons.ts";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Aperture size={23} strokeWidth={1.8} />
      </span>
      <span>
        帧序<span className="brand-en">FrameFlow</span>
      </span>
      <span className="demo-tag">DEMO</span>
    </div>
  );
}
export function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.floor((seconds % 1) * 10))}`;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
