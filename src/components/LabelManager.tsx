import { useEffect, useState } from "react";
import type { Project } from "../core/types.ts";
import { addLabel, editLabel, removeLabel } from "../core/labels.ts";
import { Plus, X } from "./icons.ts";
export function LabelManager({
  project,
  update,
  disabled = false,
}: {
  project: Project;
  update: (change: (p: Project) => Project) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(""),
    [editing, setEditing] = useState<number | null>(null),
    [name, setName] = useState(""),
    [color, setColor] = useState("#4478ef"),
    [deleting, setDeleting] = useState<number | null>(null),
    [replacement, setReplacement] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    setEditing(null);
    setDeleting(null);
    setError("");
  }, [project.id]);
  const attempt = (change: (p: Project) => Project, success: () => void) => {
    try {
      update(change);
      setError("");
      success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    }
  };
  const removing = project.labels.find((l) => l.id === deleting);
  return (
    <div className="label-manager">
      <div className="label-manager-rows">
        {project.labels.map((label) => {
          const used = project.tracks.filter(
            (t) => t.labelId === label.id,
          ).length;
          return (
            <div key={label.id} className="label-manager-row">
              {editing === label.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    attempt(
                      (p) => editLabel(p, label.id, { name, color }),
                      () => setEditing(null),
                    );
                  }}
                  className="label-edit-form"
                >
                  <input
                    type="color"
                    aria-label={`类别颜色 ${label.name}`}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={disabled}
                  />
                  <input
                    aria-label={`类别名称 ${label.name}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    autoFocus
                    disabled={disabled}
                  />
                  <button
                    className="button small primary"
                    disabled={disabled}
                    type="submit"
                  >
                    保存类别
                  </button>
                  <button
                    className="text-button"
                    disabled={disabled}
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setError("");
                    }}
                  >
                    取消编辑
                  </button>
                </form>
              ) : (
                <>
                  <i
                    className="category-dot"
                    style={{ background: label.color }}
                  />
                  <button
                    className="label-name-button"
                    aria-label={`编辑类别 ${label.name}`}
                    disabled={disabled || !!removing}
                    onClick={() => {
                      setEditing(label.id);
                      setName(label.name);
                      setColor(label.color);
                      setError("");
                    }}
                  >
                    {label.name}
                  </button>
                  <small>{used} 个对象</small>
                  <button
                    className="text-button"
                    aria-label={`重命名类别 ${label.name}`}
                    disabled={disabled || !!removing}
                    onClick={() => {
                      setEditing(label.id);
                      setName(label.name);
                      setColor(label.color);
                      setError("");
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="label-remove"
                    aria-label={`删除类别 ${label.name}`}
                    title={
                      project.labels.length === 1
                        ? "至少保留一个类别，可先添加新类别"
                        : "删除类别"
                    }
                    disabled={
                      disabled || project.labels.length < 2 || !!removing
                    }
                    onClick={() => {
                      const ids = new Set(
                        project.tracks
                          .filter((t) => t.labelId === label.id)
                          .map((t) => t.id),
                      );
                      setEditing(null);
                      setError("");
                      if (project.annotations.some((a) => ids.has(a.trackId))) {
                        setDeleting(label.id);
                        setReplacement(
                          project.labels.find((l) => l.id !== label.id)!.id,
                        );
                      } else
                        attempt(
                          (p) => removeLabel(p, label.id),
                          () => {},
                        );
                    }}
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {removing && (
        <div className="label-migration" role="group" aria-label="类别迁移">
          <p>「{removing.name}」已有标注。选择迁移类别，保留对象与全部框。</p>
          <div>
            <select
              aria-label="迁移到的类别"
              value={replacement}
              disabled={disabled}
              onChange={(e) => setReplacement(Number(e.target.value))}
            >
              {project.labels
                .filter((l) => l.id !== deleting)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <button
              className="button small"
              disabled={disabled}
              onClick={() => setDeleting(null)}
            >
              取消
            </button>
            <button
              className="button small primary"
              disabled={disabled}
              onClick={() =>
                attempt(
                  (p) => removeLabel(p, removing.id, replacement),
                  () => setDeleting(null),
                )
              }
            >
              迁移并删除
            </button>
          </div>
        </div>
      )}
      <form
        className="add-label"
        onSubmit={(e) => {
          e.preventDefault();
          attempt(
            (p) => addLabel(p, adding),
            () => setAdding(""),
          );
        }}
      >
        <input
          aria-label="新类别名称"
          placeholder="添加类别"
          maxLength={80}
          value={adding}
          disabled={disabled || !!removing}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button
          className="button icon"
          aria-label="添加类别"
          title="添加类别"
          type="submit"
          disabled={disabled || !!removing || !adding.trim()}
        >
          <Plus size={17} />
        </button>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {project.labels.length === 1 && (
        <p className="label-minimum">
          至少保留一个类别；可先添加新类别再删除。
        </p>
      )}
    </div>
  );
}
