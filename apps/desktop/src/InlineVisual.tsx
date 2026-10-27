import { useEffect, useRef, useState } from "react";
import { request } from "./types";
import { Maximize2, X, RefreshCw } from "lucide-react";
export function InlineVisual({
  visual,
}: {
  visual: {
    id: string;
    title: string;
    measurements: { width: number; height: number }[];
  };
}) {
  const [html, setHtml] = useState(""),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(375);
  const box = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const expandedDialog = useRef<HTMLDivElement>(null);
  const sendTheme = (target: HTMLIFrameElement) => {
    const style = getComputedStyle(document.documentElement);
    target.contentWindow?.postMessage(
      {
        type: "workspace-theme",
        scheme:
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        colors: Object.fromEntries(
          Object.entries({
            background: "--surface",
            foreground: "--fg",
            muted: "--muted",
            accent: "--accent",
            border: "--line",
          }).map(([key, value]) => [key, style.getPropertyValue(value).trim()]),
        ),
      },
      "*",
    );
  };
  useEffect(() => {
    const observer = new MutationObserver(() =>
      box.current
        ?.closest("section")
        ?.querySelectorAll("iframe")
        .forEach(sendTheme),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    setHtml("");
    setError("");
    setExpanded(false);
    request("/v1/visuals/" + visual.id)
      .then((r) => {
        if (live) setHtml(r.html);
      })
      .catch(() => {
        if (live)
          setError("Görsel yüklenemedi. Bağlantıyı kontrol edip yeniden dene.");
      });
    return () => {
      live = false;
    };
  }, [visual.id, attempt]);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const dialog = expandedDialog.current;
    const closeButton = dialog?.querySelector<HTMLButtonElement>("button");
    closeButton?.focus();
    const keepFocus = (event: FocusEvent) => {
      if (!dialog?.contains(event.target as Node)) closeButton?.focus();
    };
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    document.addEventListener("focusin", keepFocus);
    return () => {
      window.removeEventListener("keydown", close);
      document.removeEventListener("focusin", keepFocus);
      expandButton.current?.focus();
    };
  }, [expanded]);
  const height = Math.min(
    1600,
    Math.max(
      200,
      ...visual.measurements
        .filter((m) => m.width >= Math.min(width, 728))
        .map((m) => m.height),
    ),
  );
  const frame = (full: boolean) => (
    <iframe
      title={visual.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={(e) => sendTheme(e.currentTarget)}
      src={"workspace-visual://page/" + visual.id}
      style={{
        width: "100%",
        height: full ? "100%" : height,
        border: 0,
        colorScheme: "inherit",
      }}
    />
  );
  return (
    <section className="inline-visual" aria-label={visual.title}>
      <div className="visual-toolbar">
        <strong>{visual.title}</strong>
        <button
          ref={expandButton}
          aria-label="Görseli büyüt"
          disabled={!html}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div ref={box}>
        {error ? (
          <button onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw size={14} /> {error}
          </button>
        ) : html ? (
          frame(false)
        ) : (
          <p>Görsel yükleniyor…</p>
        )}
      </div>
      {expanded && (
        <div className="overlay">
          <div
            ref={expandedDialog}
            className="visual-expanded"
            role="dialog"
            aria-modal="true"
            aria-label={visual.title}
          >
            <div className="visual-toolbar">
              <strong>{visual.title}</strong>
              <button
                aria-label="Kapat"
                onClick={() => setExpanded(false)}
              >
                <X size={20} />
              </button>
            </div>
            {frame(true)}
          </div>
        </div>
      )}
    </section>
  );
}
