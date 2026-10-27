import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import React, { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { safeHtmlDocument, reportLink } from "./attachment-html.mjs";

GlobalWorkerOptions.workerSrc = workerUrl;
export type Attachment = {
  id: string;
  name: string;
  content: string;
  deviceId?: string;
};
const bytes = (content: string) =>
  Uint8Array.from(atob(content), (c) => c.charCodeAt(0));

function PdfPreview({ file }: { file: Attachment }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const task = getDocument({
      data: bytes(file.content),
      useSystemFonts: true,
    });
    task.onPassword = () => {
      if (live) {
        setError("Bu PDF parola istiyor. İndirip Preview ile açabilirsin.");
        setLoading(false);
      }
    };
    task.promise
      .then((pdf) => {
        if (live) setDoc(pdf);
      })
      .catch(() => {
        if (live) {
          setError(
            "PDF açılamadı. Dosyayı indirip başka bir uygulamada deneyebilirsin.",
          );
          setLoading(false);
        }
      });
    return () => {
      live = false;
      void task.destroy();
    };
  }, [file.content]);
  useEffect(() => {
    if (!doc) return;
    let live = true,
      render: RenderTask | undefined;
    setLoading(true);
    doc
      .getPage(page)
      .then(async (p) => {
        if (!live || !canvas.current) return;
        // Bound canvas memory even for unusual page dimensions.
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(900 / base.width, 1200 / base.height) * zoom;
        const viewport = p.getViewport({ scale });
        const el = canvas.current;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        el.width = Math.ceil(viewport.width * ratio);
        el.height = Math.ceil(viewport.height * ratio);
        el.style.width = viewport.width + "px";
        el.style.height = viewport.height + "px";
        render = p.render({
          canvas: el,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (live) setLoading(false);
      })
      .catch((e) => {
        if (live && e.name !== "RenderingCancelledException") {
          setError("Bu sayfa görüntülenemedi.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
      render?.cancel();
    };
  }, [doc, page, zoom]);
  return (
    <div className="document-preview">
      <div className="preview-toolbar">
        <button
          disabled={!doc || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Önceki sayfa
        </button>
        <span aria-live="polite">
          {page} / {doc?.numPages ?? "…"}
        </span>
        <button
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Sonraki sayfa
        </button>
        <select
          aria-label="PDF yakınlaştırma"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        >
          {[0.5, 0.75, 1, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              %{z * 100}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && !error && <p role="status">PDF yükleniyor…</p>}
      <div className="pdf-scroll">
        <canvas ref={canvas} aria-label={file.name + " — sayfa " + page} />
      </div>
    </div>
  );
}

export function AttachmentPreview({ file }: { file: Attachment }) {
  const [source, setSource] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setSource(false);
    setImageError(false);
    setCopyStatus("");
  }, [file.id]);
  if (/\.pdf$/i.test(file.name))
    return <PdfPreview key={file.id} file={file} />;
  if (/\.(png|jpe?g|webp|gif)$/i.test(file.name))
    return imageError ? (
      <p role="alert">Görsel açılamadı. Dosyayı indirip başka bir uygulamada açmayı deneyebilirsin.</p>
    ) : (
      <img
        className="image-preview"
        alt={file.name}
        onError={() => setImageError(true)}
        src={
          "data:image/" +
          (/\.jpe?g$/i.test(file.name) ? "jpeg" : file.name.split(".").pop()) +
          ";base64," +
          file.content
        }
      />
    );
  const text = new TextDecoder().decode(bytes(file.content));
  if (/\.(md|markdown)$/i.test(file.name))
    return (
      <div className="document-preview">
        <div className="preview-toolbar">
          <button onClick={() => setSource((v) => !v)}>
            {source ? "Önizleme" : "Ham metin"}
          </button>
          <button onClick={() => {
            void window.desktop.copyText(text)
              .then(() => setCopyStatus("Kopyalandı"))
              .catch(() => setCopyStatus("Kopyalanamadı. Yeniden dene."));
          }}>
            Kopyala
          </button>
          <span role="status">{copyStatus}</span>
        </div>
        {source ? (
          <pre className="file-preview">{text.slice(0, 100000)}</pre>
        ) : (
          <div className="file-preview markdown-preview">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ alt }) => <span>[Görsel: {alt}]</span>,
                a: ({ children }) => <span>{children}</span>,
              }}
            >
              {text.slice(0, 100000)}
            </Markdown>
          </div>
        )}
      </div>
    );
  if (/\.html?$/i.test(file.name)) return <HtmlReport name={file.name} text={text} />;
  return <pre className="file-preview">{text.slice(0, 100000)}</pre>;
}

function HtmlReport({ name, text }: { name: string; text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let url: string | undefined;
    setPage(null);
    setError("");
    void window.desktop.createReport(safeHtmlDocument(text)).then(value => {
      url = value;
      if (disposed) void window.desktop.releaseReport(value);
      else setPage(value);
    }).catch(() => { if (!disposed) setError("Rapor açılamadı. Kapatıp yeniden dene."); });
    return () => { disposed = true; if (url) void window.desktop.releaseReport(url); };
  }, [text]);
  useEffect(() => {
    setLink(null);
    const receive = (event: MessageEvent) => {
      const url = reportLink(event, frame.current?.contentWindow);
      if (url) setLink(url);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [text]);
  return <div className="document-preview">
    <div className="preview-toolbar">
      <button onClick={() => setSource(v => !v)}>{source ? "Önizlemeyi göster" : "Kaynağı göster"}</button>
      <small>Yerel etkileşimler açık. Dış bağlantılar tarayıcıda açılır.</small>
    </div>
    {link && <div className="preview-toolbar"><span style={{ overflowWrap: "anywhere" }}>{link}</span>
      <button onClick={() => { void window.desktop.openLink(link); setLink(null); }}>Tarayıcıda aç</button>
      <button onClick={() => setLink(null)}>Vazgeç</button></div>}
    {source ? <pre className="file-preview">{text.slice(0, 100000)}</pre> :
      error ? <p role="alert">{error}</p> : !page ? <p>Rapor yükleniyor…</p> : <iframe ref={frame} className="html-preview" title={name + " önizleme"} sandbox="allow-scripts"
        referrerPolicy="no-referrer" src={page} />}
  </div>;
}
