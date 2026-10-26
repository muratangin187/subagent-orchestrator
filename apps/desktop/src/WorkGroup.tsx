import { useState, useEffect } from "react";
import {
  ChevronRight,
  Terminal,
  FileText,
  FilePen,
  Search,
  Wrench,
  Brain,
  Loader2,
  Check,
  AlertCircle,
  Minus,
} from "lucide-react";
import Markdown from "react-markdown";
import { duration } from "./timeline.mjs";
export type WorkItem = {
  id: string;
  kind: string;
  title: string;
  state: string;
  input?: string;
  output?: string;
  startedAt?: number;
  endedAt?: number;
};
export type WorkRun = {
  runId: string;
  start?: number;
  end?: number;
  state: string;
  items: WorkItem[];
};
function Elapsed({ run }: { run: WorkRun }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run.end || !run.start) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run.end, run.start]);
  return (
    <>
      {run.end ? "Worked for" : "Working for"}{" "}
      {run.start ? duration((run.end || now) - run.start) : "…"}
    </>
  );
}
function Item({ item }: { item: WorkItem }) {
  const [expanded, setExpanded] = useState(false);
  const Icon =
    (
      {
        command: Terminal,
        read: FileText,
        edit: FilePen,
        search: Search,
        thinking: Brain,
      } as any
    )[item.kind] || Wrench;
  return (
    <div className={"work-item " + item.state}>
      <button
        className="work-item-head"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon size={15} />
        <span className="work-item-title">{item.title}</span>
        <span className="work-item-preview">
          {(item.input || item.output || "").replace(/\s+/g, " ").slice(0, 100)}
        </span>
        {item.state === "running" ? (
          <Loader2 size={13} className="progress-spinner" />
        ) : item.state === "failed" ? (
          <AlertCircle size={13} />
        ) : item.state === "completed" ? (
          <Check size={13} />
        ) : (
          <Minus size={13} />
        )}
        <ChevronRight
          size={13}
          className={expanded ? "expanded-chevron" : ""}
        />
      </button>
      {expanded && (
        <div className="work-item-detail">
          {item.input && (
            <>
              <small>GİRDİ</small>
              <pre>{item.input}</pre>
            </>
          )}
          {item.output ? (
            item.kind === "thinking" ? (
              <Markdown
                components={{
                  img: ({ alt }) => <span>[Görsel: {alt}]</span>,
                  a: ({ children }) => <span>{children}</span>,
                }}
              >
                {item.output}
              </Markdown>
            ) : (
              <>
                <small>ÇIKTI</small>
                <pre>{item.output}</pre>
              </>
            )
          ) : (
            <p>
              {item.state === "running"
                ? "Sonuç bekleniyor…"
                : "Bu işlem için çıktı kaydedilmedi."}
            </p>
          )}
          {item.state === "interrupted" && <p>Tamamlanma olayı alınmadı.</p>}
        </div>
      )}
    </div>
  );
}
export function WorkGroup({ run }: { run: WorkRun }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? !run.end;
  const last = run.items.at(-1);
  return (
    <section className="work-group" aria-label="Çalışma ayrıntıları">
      <button
        className="work-group-head"
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
      >
        {!run.end ? (
          <Loader2 size={14} className="progress-spinner" />
        ) : (
          <ChevronRight
            size={14}
            className={expanded ? "expanded-chevron" : ""}
          />
        )}
        <strong>
          <Elapsed run={run} />
        </strong>
        <span>{run.items.length} işlem</span>
      </button>
      {!expanded && last && (
        <div className="work-group-preview">
          {last.title} ·{" "}
          {run.state === "failed"
            ? "Hata"
            : run.state === "cancelled"
              ? "İptal"
              : run.end
                ? "Tamamlandı"
                : "Sürüyor"}
        </div>
      )}
      {expanded && (
        <div className="work-group-list">
          {run.items.length ? (
            run.items.map((i) => <Item key={i.id} item={i} />)
          ) : (
            <div className="work-empty">
              {run.end
                ? "Bu turda araç etkinliği yok."
                : "Sağlayıcıdan yanıt bekleniyor…"}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
