function origin(value) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname))
    )
  )
    throw Error("HTTPS veya yerel sunucu adresi gerekli.");
  return u.origin;
}
function route(path, body) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/v1/") ||
    /[\\#]/.test(path)
  )
    throw Error("Geçersiz istek.");
  const u = new URL(path, "https://workspace.invalid");
  const get =
    /^\/v1\/(state|devices|limits|messages|models|native|native\/messages|voice\/(status|voices|events)|attachments\/[0-9a-f-]{36})$/i;
  const post =
    /^\/v1\/(assistant\/messages|sessions\/messages|tasks\/[0-9a-f-]{36}\/messages|task\/action|artifacts\/open|messages\/steer|upload|voice\/(transcribe|speech|config))$/i;
  if (
    u.origin !== "https://workspace.invalid" ||
    !(body === undefined ? get : post).test(u.pathname)
  )
    throw Error("Desteklenmeyen işlem.");
  if (
    body !== undefined &&
    Buffer.byteLength(JSON.stringify(body)) > 8 * 1024 * 1024
  )
    throw Error("İstek çok büyük.");
  return u.pathname + u.search;
}
function webLink(value) {
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Yalnızca web bağlantıları açılabilir.");
  return u.href;
}
module.exports = { origin, route, webLink };

function appOrigin(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "workspace:" &&
      u.hostname === "app" &&
      !u.port &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
function microphoneCheck(permission, origin, details = {}) {
  return (
    permission === "media" &&
    details.isMainFrame !== false &&
    appOrigin(details.securityOrigin || origin) &&
    details.mediaType !== "video"
  );
}
module.exports.microphoneCheck = microphoneCheck;
module.exports.appOrigin = appOrigin;
