const { randomUUID } = require("node:crypto");
const REPORT_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function createReportPages() {
  const pages = new Map();
  return {
    add(html) {
      if (typeof html !== "string" || Buffer.byteLength(html) > 8 * 1024 * 1024)
        throw Error("Rapor çok büyük.");
      if (pages.size >= 8) throw Error("Açık raporlardan birini kapat.");
      const url = "workspace-visual://report/" + randomUUID();
      pages.set(url, html);
      return url;
    },
    remove(url) { pages.delete(url); },
    clear() { pages.clear(); },
    response(url) {
      const html = pages.get(url);
      return new Response(html ?? "Rapor artık açık değil.", {
        status: html === undefined ? 404 : 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": REPORT_CSP },
      });
    },
  };
}
function bindReportLifetime(webContents, pages) {
  webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) pages.clear();
  });
  webContents.on("render-process-gone", () => pages.clear());
  webContents.on("destroyed", () => pages.clear());
}
module.exports = { createReportPages, bindReportLifetime, REPORT_CSP };
