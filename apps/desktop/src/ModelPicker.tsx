import React, { useEffect, useState, useRef } from "react";
import { ChevronDown, Search, Brain } from "lucide-react";
import { request } from "./types";
export type Selection = {
  provider: "codex" | "claude";
  model: string;
  effort?: string;
};
type Model = Selection & { label: string; efforts: string[] };
export function ModelPicker({
  value,
  onChange,
  deviceId,
}: {
  value?: Selection;
  onChange: (s: Selection) => void;
  deviceId?: string;
}) {
  const [models, setModels] = useState<Model[]>([]),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer);
    root.current?.addEventListener("keydown", key);
    const element = root.current;
    return () => { document.removeEventListener("pointerdown", pointer); element?.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => {
    setLoading(true);
    setError("");
    let live = true;
    setModels([]);
    request(
      "/v1/models?catalog=true&deviceId=" + encodeURIComponent(deviceId || ""),
    )
      .then((r) => {
        if (live) {
          setModels(r.models || []);
          setError(Object.values(r.errors || {}).join(" "));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      }).finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
    };
  }, [deviceId, reload]);
  const current = models.find(
    (m) => m.provider === value?.provider && m.model === value?.model,
  );
  const matching = models.filter(m => (m.label + " " + m.provider).toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR")));
  return (
    <div className="model-controls" ref={root}>
      <div className="model-picker">
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Model ve düşünme seviyesi"
        >
          <span>{current?.label || value?.model || "Model seç"}</span>
          <small>{value?.effort || "Otomatik"}</small>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="model-menu" role="dialog" aria-label="Model seç">
            <label>
              <Search size={15} />
              <input
                aria-label="Model ara"
                autoFocus
                placeholder="Model ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {error && <small role="status">{error}</small>}
            <div className="model-effort">
              <Brain size={15} />
              <span>Düşünme seviyesi</span>
              <select
                aria-label="Düşünme seviyesi"
                value={value?.effort || ""}
                disabled={!current?.efforts.length}
                onChange={(e) =>
                  value &&
                  onChange({ ...value, effort: e.target.value || undefined })
                }
              >
                <option value="">Otomatik</option>
                {current?.efforts.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            {loading && <p role="status">Modeller yükleniyor…</p>}
            {!loading && !matching.length && <p role="status">{search ? "Bu aramada model bulunamadı." : "Kullanılabilir model bulunamadı."}</p>}
            {error && <button type="button" onClick={() => setReload(v => v + 1)}>Yeniden dene</button>}
            {matching
              .map((m) => (
                <button
                  type="button"
                  key={m.provider + m.model}
                  aria-pressed={current === m}
                  onClick={() => {
                    onChange({ provider: m.provider, model: m.model });
                  }}
                >
                  <span>
                    {m.label}
                    <small>{m.provider === "codex" ? "Codex" : "Claude"}</small>
                  </span>
                </button>
              ))}
            <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
