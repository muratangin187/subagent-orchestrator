import React, { useEffect, useState } from "react";
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
  useEffect(() => {
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
      });
    return () => {
      live = false;
    };
  }, [deviceId]);
  const current = models.find(
    (m) => m.provider === value?.provider && m.model === value?.model,
  );
  return (
    <div className="model-controls">
      <div className="model-picker">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span>{current?.label || value?.model || "Model seç"}</span>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="model-menu" role="dialog" aria-label="Model seç">
            <label>
              <Search size={15} />
              <input
                autoFocus
                placeholder="Model ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {error && <small role="status">{error}</small>}
            {models
              .filter((m) =>
                (m.label + " " + m.provider)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((m) => (
                <button
                  type="button"
                  key={m.provider + m.model}
                  aria-pressed={current === m}
                  onClick={() => {
                    onChange({ provider: m.provider, model: m.model });
                    setOpen(false);
                  }}
                >
                  <span>
                    {m.label}
                    <small>{m.provider === "codex" ? "Codex" : "Claude"}</small>
                  </span>
                </button>
              ))}
            <button type="button" onClick={() => setOpen(false)}>
              Kapat
            </button>
          </div>
        )}
      </div>
      <Brain size={15} />
      <select
        aria-label="Reasoning seviyesi"
        value={value?.effort || ""}
        disabled={!current?.efforts.length}
        onChange={(e) =>
          value && onChange({ ...value, effort: e.target.value || undefined })
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
  );
}
