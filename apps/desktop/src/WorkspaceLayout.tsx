import React, { useEffect, useRef, useState } from "react";
import { initialLayout, splitRatio, updateLayout } from "./split-layout.mjs";
export type Layout = { left: string; right: string | null; voice: boolean };
export type PaneProps = {
  paneId: "left" | "right";
  selectedId: string;
  split: boolean;
  activePane: boolean;
  onFocusPane: () => void;
  onSelect: (id: string) => void;
  onSplit: (id: string) => void;
  onClose?: () => void;
  voiceOpen: boolean;
  onVoice: (open: boolean) => void;
  voiceTarget: HTMLDivElement | null;
};
export function WorkspaceLayout({
  Pane,
}: {
  Pane: React.ComponentType<PaneProps>;
}) {
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const latest = useRef(layout);
  const lastRight = useRef<string | null>(null);
  if (layout.right) lastRight.current = layout.right;
  const [active, setActive] = useState<"left" | "right">("left");
  const [ratio, setRatio] = useState(() => {
    try {
      return splitRatio(
        Number(localStorage.getItem("workspace-split-ratio") || 0.5),
        1600,
      );
    } catch {
      return 0.5;
    }
  });
  const [width, setWidth] = useState(1600);
  const [dragging, setDragging] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<HTMLDivElement | null>(null);
  const area = useRef<HTMLDivElement>(null);
  function change(
    action:
      | { type: "select"; pane: "left" | "right"; id: string }
      | { type: "split"; id: string }
      | { type: "close" }
      | { type: "voice"; open: boolean },
  ) {
    const next = updateLayout(latest.current, action) as Layout;
    if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
    latest.current = next;
    setLayout(next);
    if (action.type === "split") setActive("right");
    if (action.type === "close") setActive("left");
    history.pushState({ workspaceLayout: next }, "");
  }
  useEffect(() => {
    history.replaceState({ workspaceLayout: latest.current }, "");
    history.scrollRestoration = "manual";
    const pop = (event: PopStateEvent) => {
      if (!event.state?.workspaceLayout) return;
      latest.current = event.state.workspaceLayout;
      setLayout(latest.current);
      if (!latest.current.right) setActive("left");
    };
    const mouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "mousedown")
        e.button === 3 ? history.back() : history.forward();
    };
    const key = (e: KeyboardEvent) => {
      if (
        (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) ||
        (e.metaKey && ["[", "]"].includes(e.key))
      ) {
        e.preventDefault();
        e.key === "ArrowLeft" || e.key === "["
          ? history.back()
          : history.forward();
      }
    };
    window.addEventListener("popstate", pop);
    for (const type of ["mousedown", "mouseup", "auxclick"] as const)
      window.addEventListener(type, mouse, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", pop);
      for (const type of ["mousedown", "mouseup", "auxclick"] as const)
        window.removeEventListener(type, mouse, true);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (area.current) observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const bounded = splitRatio(ratio, width - 8);
  function resize(clientX: number) {
    const rect = area.current!.getBoundingClientRect();
    setRatio(
      splitRatio((clientX - rect.left) / (rect.width - 8), rect.width - 8),
    );
  }
  function remember(value: number) {
    try {
      localStorage.setItem("workspace-split-ratio", String(value));
    } catch {}
  }
  const pane = (paneId: "left" | "right", id: string) => (
    <Pane
      paneId={paneId}
      selectedId={id}
      split={!!layout.right}
      activePane={active === paneId && (paneId === "left" || !!layout.right)}
      onFocusPane={() => setActive(paneId)}
      onSelect={(id) => change({ type: "select", pane: paneId, id })}
      onSplit={(id) => change({ type: "split", id })}
      onClose={paneId === "right" ? () => change({ type: "close" }) : undefined}
      voiceOpen={paneId === "left" && layout.voice}
      onVoice={(open) => change({ type: "voice", open })}
      voiceTarget={voiceTarget}
    />
  );
  return (
    <div className={"desktop-layout" + (layout.voice ? " with-voice" : "")}>
      <div className="voice-slot" hidden={!layout.voice} ref={setVoiceTarget} />
      <div
        ref={area}
        className={
          "split-workspace" +
          (layout.right ? " is-split" : "") +
          (dragging ? " resizing" : "")
        }
        style={
          layout.right
            ? {
                gridTemplateColumns: `minmax(0, ${bounded}fr) 8px minmax(0, ${1 - bounded}fr)`,
              }
            : undefined
        }
      >
        <div className="chat-pane" data-pane="left">
          {pane("left", layout.left)}
        </div>
        {layout.right && (
          <>
            <div
              className="split-handle"
              role="separator"
              aria-label="Sohbet genişliklerini ayarla"
              aria-orientation="vertical"
              aria-valuemin={Math.round(splitRatio(0, width - 8) * 100)}
              aria-valuemax={Math.round(splitRatio(1, width - 8) * 100)}
              aria-valuenow={Math.round(bounded * 100)}
              tabIndex={0}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                resize(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  resize(e.clientX);
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setDragging(false);
                remember(ratio);
              }}
              onLostPointerCapture={() => setDragging(false)}
              onDoubleClick={() => {
                setRatio(0.5);
                remember(0.5);
              }}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key))
                  return;
                e.preventDefault();
                const value =
                  e.key === "Home"
                    ? 0.5
                    : splitRatio(
                        bounded + (e.key === "ArrowLeft" ? -0.03 : 0.03),
                        width - 8,
                      );
                setRatio(value);
                remember(value);
              }}
            >
              <span />
            </div>
          </>
        )}
        {lastRight.current && (
          <div className="chat-pane" data-pane="right" hidden={!layout.right}>
            {pane("right", lastRight.current)}
          </div>
        )}
      </div>
    </div>
  );
}
