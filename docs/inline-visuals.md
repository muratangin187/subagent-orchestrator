# Interactive visuals in chat

Codex and Claude sessions can publish self-contained HTML directly into the desktop
and Android transcript. This is independent of T3: there are no T3 runtime imports.

## Ask for a visual

For example:

- “Güneş çevresinde Dünya ve Mars'ın hareketini, zaman kaydırıcısı ve oynat/duraklat düğmeleriyle göster.”
- “Bu haftalık verileri etkileşimli bir grafikte karşılaştır; metrik seçimi ve açılır veri tablosu olsun.”

Provider instructions and MCP descriptions explain that the result appears **inside
chat**, so the agent should not return a code block or invent a download link.
Small visual answers can be created by the assistant directly. Longer implementation
work still uses asynchronous children; a child publishes into its own conversation.

## Tool lifecycle

1. `html_preview({html})` renders at 375 and 728 CSS pixels. It returns two PNGs,
   script errors, horizontal overflow, measured heights and a `previewId`.
2. The agent inspects the screenshots and fixes errors before proceeding.
3. `html_render({html, title, previewId, clientRequestId})` requires the exact
   previewed source and the same task. A stable request ID prevents duplicate
   publication after a transport retry.
4. The HTML is stored separately from bounded tool events. A small `html_render`
   event keeps the visual in chronological order between text messages.
5. Clients retrieve it through authenticated `GET /v1/visuals/:id`, with task
   ownership enforcement. Reloading the conversation preserves the visual.

The desktop has an isolated `workspace-visual:` protocol and a sandboxed iframe.
Android serves an intercepted local document into a WebView with no native bridge.
Both support an expanded view. Theme colors are supplied by the host. Interactive
state is local to each view: reopening or expanding starts a fresh instance, and
slider/filter selections are not synchronized between devices.

## Boundaries

- Inline CSS/JS, SVG, Canvas and embedded data images are supported.
- Network, external libraries, frames, workers, forms and file access are blocked.
  A visualization cannot call tools, send chat messages or access the parent UI.
- Maximum source size: 512,000 bytes. Preview is serialized and has a bounded
  browser lifetime. Inline height is capped at 1,600 CSS pixels; longer documents
  scroll and can be expanded. Avoid viewport-relative heights.
- A successful preview is a render check, not a proof that every interaction or
  factual claim is correct. Label sample data and simplified simulations.
- Even G2 does not render HTML; use the phone or desktop for these visuals.

## Coordinator setup

Install the browser on the computer running the coordinator (not on the phone):

```sh
npm ci
npx playwright install chromium
```

On Linux, Chromium also needs its system libraries; Playwright documents these in
`npx playwright install-deps chromium`. Linux previews keep the Chromium sandbox
on. Missing browsers or sandbox prerequisites cause an explicit preview error,
not an automatic unsafe fallback.

Examples live in `examples/visuals/solar-system.html` and `examples/visuals/charts.html`.
`test/visuals.test.ts` covers controls at both widths, sandbox separation, network
blocking, invalid source and preview binding. Gateway and desktop tests cover
ownership, authentication, route restrictions and chronological placement.
