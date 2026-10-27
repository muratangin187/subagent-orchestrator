/** Local report scripts run only inside an opaque-origin, allow-scripts iframe. */
export function safeHtmlDocument(source) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  doc.querySelectorAll('meta,base,iframe,frame,object,embed,link,form,audio,video').forEach(el => el.remove());
  doc.querySelectorAll('script[src]').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of ['srcdoc','ping','action','formaction','target','download']) el.removeAttribute(attr);
  });
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const bootstrap = `for(const name of ['RTCPeerConnection','webkitRTCPeerConnection']){try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false})}catch{}}addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;const href=a.getAttribute('href');if(href.startsWith('#'))return;e.preventDefault();e.stopImmediatePropagation();if(e.isTrusted&&/^https?:\\/\\//i.test(href))parent.postMessage({type:'report-link',url:href},'*')},true);`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${bootstrap}</script>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
}

export function reportLink(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.data?.type !== 'report-link') return null;
  try {
    if (typeof event.data.url !== 'string' || event.data.url.length > 8192) return null;
    const url = new URL(event.data.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
