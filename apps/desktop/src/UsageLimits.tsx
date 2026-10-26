import { useEffect, useState } from "react";
import { request } from "./types";
type Window = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt?: number;
};
type Limits = {
  provider: string;
  windows: Window[];
  checkedAt: number;
  error?: string;
};
export function UsageLimits({
  deviceId,
  connected,
}: {
  deviceId?: string;
  connected: boolean;
}) {
  const [providers, setProviders] = useState<Limits[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      busy = false;
    setProviders([]);
    setError("");
    async function refresh() {
      if (!connected || busy) return;
      busy = true;
      try {
        const data = await request(
          "/v1/limits?deviceId=" + encodeURIComponent(deviceId || ""),
        );
        if (live) {
          setProviders(data.providers || []);
          setError("");
        }
      } catch {
        if (live) setError("Limitler güncellenemedi.");
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [deviceId, connected]);
  return (
    <details className="usage-limits">
      <summary aria-label="Sağlayıcıların kalan kotası">
        <small>KALAN KOTA · {deviceId || "yerel"}</small>
        {["codex", "claude"].map((provider) => {
          const row = providers.find((p) => p.provider === provider);
          const window = row?.windows.reduce<Window | undefined>(
            (a, b) => (!a || b.usedPercent > a.usedPercent ? b : a),
            undefined,
          );
          return (
            <div className="usage-provider" key={provider}>
              <span>
                {provider === "codex" ? "Codex" : "Claude"}
                <small>{window?.label || "Bilgi yok"}</small>
              </span>
              <strong>
                {window ? `${Math.round(100 - window.usedPercent)}%` : "—"}
              </strong>
              <progress
                aria-label={`${provider} kalan kota`}
                max={100}
                value={window ? 100 - window.usedPercent : 0}
                className={!window ? "unknown" : ""}
              />
            </div>
          );
        })}
      </summary>
      <div className="usage-popover">
        <h3>Kalan kota</h3>
        <p>En az kotası kalan dönem özetlenir. Yüzdeler kalan payı gösterir.</p>
        {!connected && <p>Bağlantı yok.</p>}
        {error && (
          <p role="status">{error} Son alınan değerler gösteriliyor.</p>
        )}
        {providers.map((p) => (
          <section key={p.provider}>
            <h4>{p.provider === "codex" ? "Codex" : "Claude"}</h4>
            {p.error && <p>{p.error}</p>}
            {p.windows.map((w) => (
              <div className="usage-window" key={w.id}>
                <span>{w.label}</span>
                <strong>{Math.round(100 - w.usedPercent)}%</strong>
                <progress max={100} value={100 - w.usedPercent} />
                <small>
                  {w.resetsAt
                    ? `Yenilenme: ${new Date(w.resetsAt).toLocaleString("tr-TR")}`
                    : "Yenilenme zamanı bilinmiyor"}
                </small>
              </div>
            ))}
            <small>
              Kontrol: {new Date(p.checkedAt).toLocaleTimeString("tr-TR")}
            </small>
          </section>
        ))}
      </div>
    </details>
  );
}
