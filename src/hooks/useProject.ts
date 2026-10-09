import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../core/types.ts";
import { parseProject } from "../core/project.ts";

export const STORAGE_KEY = "frameflow-project-v1";
export function savedProject(): Project | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? parseProject(value) : null;
  } catch {
    return null;
  }
}
export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const [revision, setRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const current = useRef<Project | null>(null);
  const past = useRef<Project[]>([]),
    future = useRef<Project[]>([]);
  const replace = useCallback((next: Project) => {
    current.current = next;
    setProject(next);
  }, []);
  const initialize = useCallback(
    (next: Project) => {
      past.current = [];
      future.current = [];
      replace(next);
      setRevision((r) => r + 1);
    },
    [replace],
  );
  const checkpoint = useCallback(() => {
    if (current.current) {
      past.current = [...past.current.slice(-49), current.current];
      future.current = [];
      setRevision((r) => r + 1);
    }
  }, []);
  const update = useCallback(
    (change: (previous: Project) => Project, history = true) => {
      if (!current.current) return;
      const next = change(current.current);
      if (next === current.current) return;
      if (history) checkpoint();
      replace(next);
    },
    [checkpoint, replace],
  );
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !current.current) return;
    future.current.push(current.current);
    replace(prev);
    setRevision((r) => r + 1);
  }, [replace]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !current.current) return;
    past.current.push(current.current);
    replace(next);
    setRevision((r) => r + 1);
  }, [replace]);
  const persist = useCallback(() => {
    if (!current.current) return true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current));
      setSaveStatus(
        window.location.protocol === "file:"
          ? "已暂存到浏览器"
          : "已保存到本机",
      );
      return true;
    } catch {
      setSaveStatus("保存失败，请下载工程");
      return false;
    }
  }, []);
  useEffect(() => {
    if (!project) return;
    setSaveStatus("保存中");
    const timeout = setTimeout(persist, 350);
    return () => clearTimeout(timeout);
  }, [project, persist]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!persist()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hidden);
      persist();
    };
  }, [persist]);
  return {
    project,
    current,
    initialize,
    update,
    checkpoint,
    undo,
    redo,
    canUndo: revision >= 0 && past.current.length > 0,
    canRedo: future.current.length > 0,
    saveStatus,
  };
}
