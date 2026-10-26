import React, { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { safeHtmlDocument } from "./attachment-html.mjs";

GlobalWorkerOptions.workerSrc = workerUrl;
export type Attachment = { id: string; name: string; content: string };
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
  if (/\.pdf$/i.test(file.name))
    return <PdfPreview key={file.id} file={file} />;
  if (/\.(png|jpe?g|webp)$/i.test(file.name))
    return (
      <img
        className="image-preview"
        alt={file.name}
        src={
          "data:image/" +
          (/\.jpe?g$/i.test(file.name) ? "jpeg" : file.name.split(".").pop()) +
          ";base64," +
          file.content
        }
      />
    );
  const text = new TextDecoder().decode(bytes(file.content));
  if (/\.html?$/i.test(file.name))
    return (
      <div className="document-preview">
        <div className="preview-toolbar">
          <button onClick={() => setSource((v) => !v)}>
            {source ? "Önizlemeyi göster" : "Kaynağı göster"}
          </button>
          <small>Betikler ve dış bağlantılar kapalı.</small>
        </div>
        {source ? (
          <pre className="file-preview">{text.slice(0, 100000)}</pre>
        ) : (
          <iframe
            className="html-preview"
            title={file.name + " önizleme"}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={safeHtmlDocument(text)}
          />
        )}
      </div>
    );
  return <pre className="file-preview">{text.slice(0, 100000)}</pre>;
}
