import DOMPurify from "dompurify";

/** Untrusted documents stay inert even if their markup tries to replace the CSP. */
export function safeHtmlDocument(source) {
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "frame",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "meta",
      "base",
      "link",
      "audio",
      "video",
    ],
    FORBID_ATTR: [
      "href",
      "action",
      "formaction",
      "srcset",
      "ping",
      "target",
      "download",
      "srcdoc",
    ],
  });
  // CSP is placed before all document content. The iframe also has an empty sandbox.
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'\"></head><body>" +
    clean +
    "</body></html>"
  );
}
