const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  dialog,
  shell,
  safeStorage,
  Menu,
  Notification,
  systemPreferences,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const policy = require("./policy.cjs");
app.setName("Agent Workspace");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "workspace",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win, connection;
const file = () => path.join(app.getPath("userData"), "connection.enc");
async function save(c) {
  if (!safeStorage.isEncryptionAvailable())
    throw Error("macOS güvenli anahtar deposu kullanılamıyor.");
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(
    file(),
    await safeStorage.encryptStringAsync(JSON.stringify(c)),
    {
      mode: 0o600,
    },
  );
  connection = c;
  return { connected: true, origin: c.origin };
}
async function request(p, b, c = connection) {
  if (!c) throw Error("Önce bilgisayara bağlan.");
  const endpoint = policy.route(p, b);
  const response = await fetch(c.origin + endpoint, {
    method: b === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + c.token,
      "Content-Type": "application/json",
    },
    body: b === undefined ? undefined : JSON.stringify(b),
    redirect: "error",
    signal: AbortSignal.timeout(b === undefined ? 15000 : 55000),
  }).catch(() => {
    throw Error(
      b === undefined
        ? "Sunucuya ulaşılamıyor. Bağlantıyı kontrol et."
        : "Gönderim sonucu belirsiz. Tekrar göndermeden önce sohbeti kontrol et.",
    );
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      response.status === 401
        ? "Bağlantı anahtarı geçersiz. Yeniden bağlan."
        : String(data.error || "Sunucu hatası"),
    );
  if (
    endpoint === "/v1/state" &&
    typeof data.coordinatorUrl === "string" &&
    data.coordinatorUrl !== c.origin
  ) {
    const next = policy.origin(data.coordinatorUrl);
    if (
      !next.startsWith("https://") ||
      !new URL(next).hostname.endsWith(".ts.net")
    )
      throw Error("Invalid coordinator address");
    await save({ ...c, origin: next });
  }
  return data;
}
async function pair(c) {
  c = { origin: policy.origin(c.origin), token: c.token };
  if (!/^[a-f0-9]{64}$/.test(c.token))
    throw Error("Geçersiz bağlantı dosyası.");
  const state = await request("/v1/state", undefined, c);
  return save({
    ...c,
    origin: state.coordinatorUrl
      ? policy.origin(state.coordinatorUrl)
      : c.origin,
  });
}
function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    if (
      !win ||
      e.sender !== win.webContents ||
      e.senderFrame !== win.webContents.mainFrame ||
      !e.senderFrame.url.startsWith("workspace://app/")
    )
      throw Error("Geçersiz pencere.");
    return fn(...args);
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: "Agent Workspace",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-frame-navigate", (e) => {
    if (e.url !== "about:srcdoc") e.preventDefault();
  });
  win.loadURL("workspace://app/index.html");
  win.on("closed", () => {
    win = undefined;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app.whenReady().then(async () => {
    // Keychain authorization must not block the Electron main thread or window creation.
    const connectionReady = (async () => {
      try {
        const decrypted = await safeStorage.decryptStringAsync(
          await fs.readFile(file()),
        );
        connection = JSON.parse(decrypted.result);
        connection.origin = policy.origin(connection.origin);
      } catch {
        connection = undefined;
      }
    })();
    protocol.handle("workspace", async (req) => {
      const u = new URL(req.url);
      const relative = decodeURIComponent(u.pathname).replace(/^\//, "");
      const base = path.join(__dirname, "../dist");
      const target = path.resolve(base, relative);
      if (u.host !== "app" || !target.startsWith(base + path.sep))
        return new Response("", { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission, origin, details) =>
        wc === win?.webContents &&
        policy.microphoneCheck(permission, origin, details),
    );
    session.defaultSession.setPermissionRequestHandler(
      (wc, permission, cb, details) =>
        cb(
          wc === win?.webContents &&
            permission === "media" &&
            details.isMainFrame !== false &&
            policy.appOrigin(details.requestingUrl) &&
            details.mediaTypes?.length > 0 &&
            details.mediaTypes.every((t) => t === "audio"),
        ),
    );
    handle("microphone-access", async () => {
      if (process.platform !== "darwin") return true;
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") return true;
      if (
        status === "not-determined" &&
        (await systemPreferences.askForMediaAccess("microphone"))
      )
        return true;
      throw Error(
        "macOS mikrofon izni kapalı. Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon bölümünde Agent Workspace erişimini açıp uygulamayı yeniden başlat.",
      );
    });
    handle("connection", async () => {
      await connectionReady;
      return { connected: !!connection, origin: connection?.origin };
    });
    handle("connect-local", async () =>
      pair({
        origin: "http://127.0.0.1:8787",
        token: (
          await fs.readFile(
            path.join(
              os.homedir(),
              ".local/share/agent-workspace/device-secret",
            ),
            "utf8",
          )
        ).trim(),
      }),
    );
    handle("import-connection", async () => {
      const r = await dialog.showOpenDialog(win, {
        title: "Özel bağlantı dosyasını seç",
        properties: ["openFile"],
        filters: [{ name: "Bağlantı", extensions: ["json"] }],
      });
      if (r.canceled) return null;
      const p = r.filePaths[0];
      if ((await fs.stat(p)).size > 8192) throw Error("Dosya çok büyük.");
      return pair(JSON.parse(await fs.readFile(p, "utf8")));
    });
    handle("disconnect", async () => {
      connection = undefined;
      await fs.rm(file(), { force: true });
    });
    handle("request", (p, b) => request(p, b));
    handle("open-link", (url) => shell.openExternal(policy.webLink(url)));
    handle("save-attachment", async (id) => {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("Geçersiz dosya.");
      const a = await request("/v1/attachments/" + id);
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.basename(a.name),
      });
      if (r.canceled) return false;
      await fs.writeFile(r.filePath, Buffer.from(a.content, "base64"));
      return true;
    });
    handle("open-attachment", async (id) => {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("Geçersiz dosya.");
      const a = await request("/v1/attachments/" + id);
      if (!/\.(pdf|html?|png|jpe?g|webp|txt|md|csv)$/i.test(a.name))
        throw Error("Bu dosya türünü önce kaydet.");
      const dir = await fs.mkdtemp(
        path.join(app.getPath("temp"), "workspace-preview-"),
      );
      const target = path.join(dir, path.basename(a.name));
      await fs.writeFile(target, Buffer.from(a.content, "base64"), {
        mode: 0o600,
      });
      const error = await shell.openPath(target);
      if (error) throw Error("Dosya açılamadı: " + error);
    });
    const notified = new Set();
    handle("notify", (id) => {
      if (typeof id !== "string" || notified.has(id) || win?.isFocused())
        return;
      notified.add(id);
      if (notified.size > 500) notified.delete(notified.values().next().value);
      const n = new Notification({
        title: "Agent Workspace",
        body: "Bir iş güncellendi. Ayrıntıları görmek için aç.",
      });
      n.on("click", () => {
        win?.show();
        win?.focus();
      });
      n.show();
    });
    const command = (cmd) => () => win?.webContents.send("command", cmd);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Agent Workspace",
          submenu: [
            { role: "about" },
            { type: "separator" },
            {
              label: "Ayarlar",
              accelerator: "CmdOrCtrl+,",
              click: command("settings"),
            },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        {
          label: "Çalışma alanı",
          submenu: [
            {
              label: "Yeni oturum",
              accelerator: "CmdOrCtrl+N",
              click: command("new"),
            },
            {
              label: "Ara",
              accelerator: "CmdOrCtrl+K",
              click: command("search"),
            },
            {
              label: "Asistan",
              accelerator: "CmdOrCtrl+1",
              click: command("assistant"),
            },
            {
              label: "İşler",
              accelerator: "CmdOrCtrl+2",
              click: command("jobs"),
            },
            {
              label: "Oturumlar",
              accelerator: "CmdOrCtrl+3",
              click: command("sessions"),
            },
          ],
        },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    createWindow();
    app.on("activate", () => {
      if (!win) createWindow();
      else win.show();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
