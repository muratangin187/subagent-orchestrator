import { UsageLimits } from "./UsageLimits";
import { taskTree } from "./task-tree.mjs";
import { ModelPicker, type Selection } from "./ModelPicker";
import {
  transferredFiles,
  validateAttachments,
  imageThumbnail,
} from "./attachment-input.mjs";
import { AppearanceSettings } from "./AppearanceSettings";
import { WorkGroup } from "./WorkGroup";
import { workSlots } from "./timeline.mjs";
import { chatStatus } from "./chat-status.mjs";
import { AttachmentPreview } from "./AttachmentPreview";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Loader2,
  Sparkles,
  MessageSquare,
  Layers,
  Search,
  Plus,
  Settings,
  ArrowUp,
  Paperclip,
  Mic,
  X,
  ChevronRight,
  PanelRight,
  Square,
  FileText,
  Download,
  Volume2,
  Command,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Activity,
  Terminal,
  ExternalLink,
} from "lucide-react";
import {
  request,
  isActive,
  ordered,
  title,
  labels,
  toMessages,
  type Task,
  type Snapshot,
  type Event,
  type Message,
  type Native,
} from "./types";
import "./style.css";
import "./theme.css";
function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <button
      aria-label="Ham metni kopyala"
      onClick={() =>
        void window.desktop
          .copyText(text)
          .then(() => {
            setCopyError(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopyError(true))
      }
    >
      <Copy size={13} />
      {copyError
        ? "Kopyalanamadı · Tekrar dene"
        : copied
          ? "Kopyalandı"
          : "Kopyala"}
    </button>
  );
}
const empty: Snapshot = { tasks: [], inputs: [] };
const uid = () => crypto.randomUUID();
const time = (n: number) =>
  new Date(n).toLocaleTimeString("tr", { hour: "2-digit", minute: "2-digit" });
const date = (n: number) =>
  new Date(n).toLocaleDateString("tr", { day: "numeric", month: "short" });
function Badge({ task }: { task: Task }) {
  return (
    <span className={"badge " + task.status}>
      <i />
      {labels[task.status] || task.status}
    </span>
  );
}
type Route = { view: string; selected: string; external?: Native | null };
const routeKey = (r: Route) =>
  r.view === "chat" || r.view === "assistant" ? "chat:" + r.selected : r.view;
function App() {
  const [connected, setConnected] = useState(false),
    [origin, setOrigin] = useState(""),
    [offline, setOffline] = useState(false),
    [snap, setSnap] = useState<Snapshot>(empty),
    [view, setView] = useState("assistant"),
    [selected, setSelected] = useState("assistant"),
    [query, setQuery] = useState(""),
    [inspector, setInspector] = useState(true),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deliveries, setDeliveries] = useState<
      Record<string, { phase: string; previousRunId?: string }>
    >({}),
    [messages, setMessages] = useState<Message[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [older, setOlder] = useState<number | null>(null),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [files, setFiles] = useState<
      { id: string; name: string; thumbnail?: string }[]
    >([]),
    [draggingFiles, setDraggingFiles] = useState(false),
    [provider, setProvider] = useState("codex"),
    [deviceId, setDeviceId] = useState(""),
    [model, setModel] = useState(""),
    [newText, setNewText] = useState(""),
    [natives, setNatives] = useState<Native[]>([]),
    [nativeCursor, setNativeCursor] = useState<string | null>(null),
    [external, setExternal] = useState<Native | null>(null),
    [nativeHistoryCursor, setNativeHistoryCursor] = useState<string | null>(
      null,
    ),
    [nativeConfirmed, setNativeConfirmed] = useState(false),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<{
      id: string;
      name: string;
      content: string;
    } | null>(null),
    [voiceState, setVoiceState] = useState("idle"),
    [voiceElapsed, setVoiceElapsed] = useState(0),
    [micLevel, setMicLevel] = useState(0),
    [speakerMuted, setSpeakerMuted] = useState(false),
    [micId, setMicId] = useState(""),
    [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]),
    [voices, setVoices] = useState<{ id: string; name: string }[]>([]),
    [voiceId, setVoiceId] = useState("");
  const route = useRef<Route>({ view: "assistant", selected: "assistant" });
  const positions = useRef(new Map<string, number>());
  const transcripts = useRef(
    new Map<
      string,
      {
        events: Event[];
        messages: Message[];
        cursor: number;
        older: number | null;
        nativeCursor: string | null;
      }
    >(),
  );
  const pendingScroll = useRef<number | null>(null);
  const restoreRoute = useRef<(r: Route) => void>(() => {});
  const commandHandler = useRef<(cmd: string) => void>(() => {});
  const selection = useRef(selected),
    epoch = useRef(0),
    lastTasks = useRef<Map<string, string> | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    nearBottom = useRef(true),
    cursor = useRef(0),
    audio = useRef<HTMLAudioElement | null>(null),
    capture = useRef<{
      stream: MediaStream;
      ctx: AudioContext;
      node: AudioWorkletNode;
      chunks: Int16Array[];
      count: number;
      peak: number;
      timer: ReturnType<typeof setInterval>;
    } | null>(null),
    voiceGeneration = useRef(0),
    lock = useRef(false);
  const dictation = useRef<{ target: string } | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const task = snap.tasks.find(
    (t) => t.id === (selected === "assistant" ? snap.assistantId : selected),
  );
  const active = ordered(
    snap.tasks.filter((t) => !!t.parentTaskId && isActive(t)),
  );
  const children = ordered(
    snap.tasks.filter((t) => t.parentTaskId === task?.id),
  );
  const draft = drafts[selected] || "";
  const progress = chatStatus({
    task,
    delivery: deliveries[selected],
    offline,
    connected,
    activeChildren: children.filter(isActive).length,
  });
  const fail = (e: unknown) =>
    setError(
      String(e instanceof Error ? e.message : e).replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
    );
  async function work(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load(s: Snapshot = snap, old?: number) {
    const pick = selection.current;
    const id = pick === "assistant" ? s.assistantId : pick;
    if (!id || pick.startsWith("native:")) return;
    const gen = epoch.current;
    const initial = cursor.current === 0;
    const r = await request(
      "/v1/messages?taskId=" +
        id +
        (old
          ? "&before=" + old
          : initial
            ? "&tail=true"
            : "&after=" + cursor.current),
    );
    if (gen !== epoch.current || pick !== selection.current) return;
    setEvents((prev) => {
      const merged = new Map(
        [...prev, ...r.messages].map((e: Event) => [e.id, e]),
      );
      return [...merged.values()].sort((a, b) => a.id - b.id);
    });
    if (old || initial) setOlder(r.olderCursor ?? null);
    if (!old) cursor.current = Math.max(cursor.current, r.nextOffset);
  }
  async function refresh() {
    const gen = epoch.current;
    const s = await request<Snapshot>("/v1/state");
    if (gen !== epoch.current) return;
    setSnap(s);
    if (s.defaultDeviceId)
      setDeviceId((current) => current || s.defaultDeviceId!);
    setOffline(false);
    if (lastTasks.current) {
      for (const t of s.tasks) {
        const before = lastTasks.current.get(t.id);
        if (
          before &&
          before !== t.status &&
          [
            "completed",
            "failed",
            "waiting_question",
            "recovery_required",
          ].includes(t.status)
        )
          void window.desktop.notify(t.id + ":" + t.status + ":" + t.updatedAt);
      }
    }
    lastTasks.current = new Map(s.tasks.map((t) => [t.id, t.status]));
    await load(s);
  }
  useEffect(() => {
    window.desktop
      .connection()
      .then((c) => {
        setConnected(c.connected);
        setOrigin(c.origin || "");
      })
      .catch(fail);
  }, []);
  useEffect(() => {
    if (!connected) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (!dead) {
          setOffline(true);
          fail(e);
        }
      } finally {
        if (!dead) timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      dead = true;
      clearTimeout(timer);
      epoch.current++;
    };
  }, [connected, selected]);
  useEffect(() => {
    if (!external) setMessages(toMessages(events));
  }, [events, external]);
  useLayoutEffect(() => {
    const el =
      view === "chat" || view === "assistant"
        ? scroll.current
        : document.querySelector<HTMLElement>(".page");
    if (!el) return;
    if (pendingScroll.current !== null) {
      const chat = view === "chat" || view === "assistant";
      if (chat && !messages.length) return;
      el.scrollTop = pendingScroll.current;
      pendingScroll.current = null;
      nearBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    } else if (
      (view === "chat" || view === "assistant") &&
      nearBottom.current
    ) {
      el.scrollTop = el.scrollHeight;
    }
  }, [view, selected, messages, natives.length]);
  useEffect(() => {
    history.replaceState({ workspaceRoute: route.current }, "");
    history.scrollRestoration = "manual";
    const pop = (e: PopStateEvent) => {
      if (e.state?.workspaceRoute) restoreRoute.current(e.state.workspaceRoute);
    };
    const down = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 3) history.back();
        else history.forward();
      }
    };
    const cancel = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", cancel, true);
    window.addEventListener("auxclick", cancel, true);
    const off = window.desktop.onCommand((cmd) => commandHandler.current(cmd));
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mouseup", cancel, true);
      window.removeEventListener("auxclick", cancel, true);
      off();
    };
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
        (e.metaKey && (e.key === "[" || e.key === "]"))
      ) {
        e.preventDefault();
        if (e.key === "ArrowLeft" || e.key === "[") history.back();
        else history.forward();
        return;
      }
      if (e.key === "Escape") {
        setModal("");
        setPreview(null);
        stopVoice(false);
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const stop = () => {
      if (document.hidden) stopVoice(false);
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      stopVoice(false);
      audio.current?.pause();
    };
  }, []);
  useEffect(() => {
    if (!modal && !preview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = focusable();
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !dialog?.contains(document.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !dialog?.contains(document.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal, !!preview]);
  const uploadInFlight = useRef(false);
  useEffect(() => {
    const preventNavigation = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types || []).includes("Files"))
        e.preventDefault();
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);
  function savePage() {
    const current = route.current;
    const el =
      current.view === "chat" || current.view === "assistant"
        ? scroll.current
        : document.querySelector<HTMLElement>(".page");
    if (el) positions.current.set(routeKey(current), el.scrollTop);
    if (current.view === "chat" || current.view === "assistant") {
      transcripts.current.set(current.selected, {
        events,
        messages,
        cursor: cursor.current,
        older,
        nativeCursor: nativeHistoryCursor,
      });
      if (transcripts.current.size > 20)
        transcripts.current.delete(transcripts.current.keys().next().value!);
    }
  }
  function visit(next: Route, record = true) {
    if (JSON.stringify(route.current) === JSON.stringify(next)) return;
    savePage();
    if (record) history.pushState({ workspaceRoute: next }, "");
    route.current = next;
    pendingScroll.current = positions.current.get(routeKey(next)) ?? null;
    setModal("");
    setPreview(null);
    setView(next.view);
    if (next.view !== "chat" && next.view !== "assistant") {
      pendingScroll.current ??= 0;
      return;
    }
    epoch.current++;
    selection.current = next.selected;
    const cached = transcripts.current.get(next.selected);
    cursor.current = cached?.cursor ?? 0;
    setSelected(next.selected);
    setExternal(next.external || null);
    setNativeConfirmed(false);
    setMessages(cached?.messages || []);
    setEvents(cached?.events || []);
    setOlder(cached?.older ?? null);
    setNativeHistoryCursor(cached?.nativeCursor ?? null);
    setAnswers({});
    setFiles([]);
    nearBottom.current = pendingScroll.current === null;
    if (next.external && !cached)
      void work(() => loadNativeMessages(next.external!));
  }
  restoreRoute.current = (r) => visit(r, false);
  function navigate(v: string) {
    if (v === "assistant") choose("assistant");
    else if (v === "jobs" || v === "sessions") setModal(v);
  }
  function choose(id: string, n?: Native) {
    setModal("");
    visit({
      view: id === "assistant" ? "assistant" : "chat",
      selected: id,
      external: n || null,
    });
  }
  commandHandler.current = (cmd) => {
    if (cmd === "back") history.back();
    else if (cmd === "forward") history.forward();
    else if (cmd === "search") setModal("sessions");
    else if (cmd === "new" || cmd === "settings") setModal(cmd);
    else navigate(cmd);
  };
  async function connect(local: boolean) {
    const r = local
      ? await window.desktop.connectLocal()
      : await window.desktop.importConnection();
    if (!r) return;
    const c = await window.desktop.connection();
    setConnected(c.connected);
    setOrigin(c.origin || "");
    setModal("");
  }
  async function send() {
    if (!draft.trim()) return;
    const pick = selected;
    const attachments = files.map((f) => f.id);
    const body: any = {
      clientRequestId: uid(),
      text: draft.trim(),
      attachments,
      selection: selections[pick],
      ...(external ? { deviceId: external.deviceId } : {}),
    };
    let p =
      pick === "assistant"
        ? "/v1/assistant/messages"
        : "/v1/tasks/" + pick + "/messages";
    if (external) {
      if (!nativeConfirmed)
        throw Error("Önce terminalde aktif tur olmadığını doğrula.");
      p = "/v1/sessions/messages";
      Object.assign(body, {
        nativeId: external.id,
        provider: external.provider,
        confirmExternal: true,
      });
    }
    const previousRunId = task?.runId;
    setDeliveries((d) => ({
      ...d,
      [pick]: { phase: "sending", previousRunId },
    }));
    try {
      await request(p, body);
      setDeliveries((d) => ({
        ...d,
        [pick]: { phase: "accepted", previousRunId },
      }));
    } catch (e) {
      setDeliveries((d) => ({
        ...d,
        [pick]: { phase: "uncertain", previousRunId },
      }));
      throw e;
    }
    nearBottom.current = true;
    setDrafts((d) => ({ ...d, [pick]: "" }));
    setFiles([]);
    if (external) {
      setExternal(null);
      choose("assistant");
      navigate("sessions");
    }
    await refresh();
    nearBottom.current = true;
  }
  async function upload(list: FileList | File[] | null) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    if (uploadInFlight.current)
      throw Error("Devam eden dosya yüklemesini bekle.");
    const names = validateAttachments(incoming, files.length);
    const target = selection.current,
      generation = epoch.current;
    uploadInFlight.current = true;
    try {
      for (const [index, f] of incoming.entries()) {
        if (target !== selection.current || generation !== epoch.current) break;
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const thumbnail = await imageThumbnail(f);
        const a = await request("/v1/upload", {
          id: uid(),
          name: names[index],
          content,
        });
        if (target === selection.current && generation === epoch.current)
          setFiles((prev) => [...prev, { ...a, thumbnail }]);
      }
    } finally {
      uploadInFlight.current = false;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function nativeList(more = false) {
    const r = await request(
      "/v1/native?deviceId=" +
        encodeURIComponent(deviceId || snap.defaultDeviceId || "local") +
        "&provider=" +
        provider +
        (more && nativeCursor
          ? "&cursor=" + encodeURIComponent(nativeCursor)
          : ""),
    );
    setNatives((n) => (more ? [...n, ...r.sessions] : r.sessions));
    setNativeCursor(r.nextCursor || null);
  }
  async function loadNativeMessages(n: Native, more = false) {
    const pick = "native:" + n.id;
    const r = await request(
      "/v1/native/messages?deviceId=" +
        encodeURIComponent(n.deviceId || snap.localDeviceId || "local") +
        "&provider=" +
        n.provider +
        "&id=" +
        n.id +
        (more && nativeHistoryCursor
          ? "&cursor=" + encodeURIComponent(nativeHistoryCursor)
          : ""),
    );
    if (selection.current !== pick) return;
    const list: Message[] =
      n.provider === "codex"
        ? (r.thread?.turns || []).flatMap((t: any) =>
            (t.items || []).flatMap((i: any) => {
              const text =
                i.text ||
                (i.content || [])
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("\n");
              return text
                ? [
                    {
                      id: i.id || uid(),
                      role: i.type === "userMessage" ? "user" : "assistant",
                      text,
                    },
                  ]
                : [];
            }),
          )
        : (r.messages || []).map((m: any) => ({
            id: m.uuid || uid(),
            role: m.type === "user" ? "user" : "assistant",
            text:
              typeof m.message?.content === "string"
                ? m.message.content
                : (m.message?.content || [])
                    .filter((p: any) => p.type === "text")
                    .map((p: any) => p.text)
                    .join("\n"),
          }));
    setMessages((prev) =>
      more
        ? n.provider === "codex"
          ? [...list, ...prev]
          : [...prev, ...list]
        : list,
    );
    setNativeHistoryCursor(r.nextCursor || null);
  }
  useEffect(() => {
    if (modal !== "voice" || speakerMuted) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    let offset = 0;
    const poll = async () => {
      try {
        const result = await request("/v1/voice/events?after=" + offset);
        if (dead) return;
        offset = result.cursor;
        for (const event of result.events) {
          if (
            dead ||
            event.type !== "assistant_message" ||
            capture.current ||
            document.hidden
          )
            continue;
          const generation = voiceGeneration.current;
          const response = await request("/v1/voice/speech", {
            eventId: event.id,
          });
          if (
            dead ||
            capture.current ||
            generation !== voiceGeneration.current ||
            document.hidden
          )
            continue;
          audio.current?.pause();
          const player = new Audio(
            "data:" + response.mime + ";base64," + response.audio,
          );
          audio.current = player;
          setVoiceState("speaking");
          player.onended = () => {
            if (!dead) setVoiceState("idle");
          };
          await player.play();
          // Keep subsequent responses sequential; closing/muting pauses and releases this wait.
          await new Promise<void>((resolve) => {
            player.onended = () => {
              if (!dead) setVoiceState("idle");
              resolve();
            };
            player.onpause = () => resolve();
            player.onerror = () => resolve();
          });
        }
      } catch (e) {
        if (!dead) {
          fail(e);
          setVoiceState("idle");
        }
      } finally {
        if (!dead) timer = setTimeout(poll, 2000);
      }
    };
    void request("/v1/voice/status")
      .then((status) => {
        if (!dead) {
          offset = status.cursor;
          void poll();
        }
      })
      .catch((e) => {
        if (!dead) fail(e);
      });
    return () => {
      dead = true;
      clearTimeout(timer);
      audio.current?.pause();
    };
  }, [modal, speakerMuted]);

  async function startVoice(draftOnly = false) {
    dictation.current = draftOnly ? { target: selection.current } : null;
    if (capture.current || voiceState === "starting") return;
    const generation = ++voiceGeneration.current;
    setError("");
    audio.current?.pause();
    setMicLevel(0);
    setVoiceState("starting");
    try {
      const status = await request("/v1/voice/status");
      if (!status.configured)
        throw Error("Önce mobil uygulamada ElevenLabs bağlantısını kur.");
      if (generation !== voiceGeneration.current) return;
      await window.desktop.microphoneAccess();
      if (generation !== voiceGeneration.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          deviceId: micId ? { exact: micId } : undefined,
        },
        video: false,
      });
      if (generation !== voiceGeneration.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setMicrophones(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      const ctx = new AudioContext({ sampleRate: 16000 });
      try {
        await ctx.resume();
        await ctx.audioWorklet.addModule(
          new URL("./capture.js", import.meta.url),
        );
        if (generation !== voiceGeneration.current) {
          stream.getTracks().forEach((t) => t.stop());
          await ctx.close();
          return;
        }
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        ctx.createMediaStreamSource(stream).connect(node);
        node.connect(ctx.destination);
        const startedAt = Date.now();
        let lastLevel = 0;
        const state = {
          stream,
          ctx,
          node,
          chunks: [] as Int16Array[],
          count: 0,
          peak: 0,
          timer: setInterval(() => {
            setVoiceElapsed(Math.floor((Date.now() - startedAt) / 1000));
            if (Date.now() - startedAt >= 30000) stopVoice(true);
          }, 1000),
        };
        capture.current = state;
        node.port.onmessage = (e) => {
          if (capture.current !== state) return;
          const chunk = new Int16Array(e.data);
          if (state.count + chunk.length > 480000) {
            stopVoice(true);
            return;
          }
          let peak = 0;
          for (const sample of chunk) peak = Math.max(peak, Math.abs(sample));
          state.peak = Math.max(state.peak, peak);
          if (Date.now() - lastLevel > 100) {
            setMicLevel(Math.min(1, peak / 10000));
            lastLevel = Date.now();
          }
          state.count += chunk.length;
          state.chunks.push(chunk);
        };
        setVoiceElapsed(0);
        setVoiceState("recording");
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        await ctx.close();
        throw e;
      }
    } catch (e) {
      setVoiceState("idle");
      fail(e);
    }
  }
  function stopVoice(submit: boolean) {
    voiceGeneration.current++;
    const s = capture.current;
    if (!s) {
      if (!submit) audio.current?.pause();
      setVoiceState("idle");
      return;
    }
    capture.current = null;
    setMicLevel(0);
    clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.node.disconnect();
    void s.ctx.close();
    if (!submit) {
      audio.current?.pause();
      setVoiceState("idle");
      return;
    }
    if (s.count < 1600) {
      setVoiceState("idle");
      fail(new Error("Kayıt çok kısa. Biraz daha uzun konuşmayı dene."));
      return;
    }
    if (s.peak < 8) {
      setVoiceState("idle");
      fail(
        new Error(
          "Mikrofondan ses alınamadı. Giriş aygıtını kontrol edip yeniden dene.",
        ),
      );
      return;
    }
    const generation = voiceGeneration.current;
    const draftTarget = dictation.current?.target;
    setVoiceState("sending");
    const pcm = new Int16Array(s.count);
    let offset = 0;
    for (const chunk of s.chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const bytes = new Uint8Array(pcm.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    request("/v1/voice/transcribe", {
      clientRequestId: uid(),
      audio: btoa(binary),
      draftOnly: !!draftTarget,
      contextTaskId:
        selection.current === "assistant" ||
        selection.current.startsWith("native:")
          ? undefined
          : selection.current,
    })
      .then((result) => {
        if (generation !== voiceGeneration.current) return;
        if (draftTarget) {
          setDrafts((d) => ({
            ...d,
            [draftTarget]: [d[draftTarget], result.text]
              .filter(Boolean)
              .join(" "),
          }));
          setVoiceState("idle");
          dictation.current = null;
          return;
        }
        setVoiceState("sent");
        void refresh();
      })
      .catch((e) => {
        if (generation !== voiceGeneration.current) return;
        fail(e);
        setVoiceState("idle");
      });
  }
  async function speak(m: Message) {
    audio.current?.pause();
    const generation = ++voiceGeneration.current;
    const r = await request("/v1/voice/speech", { eventId: Number(m.id) });
    if (generation !== voiceGeneration.current) return;
    audio.current = new Audio("data:" + r.mime + ";base64," + r.audio);
    await audio.current.play();
  }
  const filtered = ordered(
    snap.tasks.filter((t) => t.id !== snap.assistantId && !t.parentTaskId),
  ).filter((t) =>
    title(t).toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")),
  );
  const groupedWork = workSlots(events, messages);
  const heading =
    external?.title ||
    (selected === "assistant" ? "Asistan" : task ? title(task) : "Sohbet");
  const row = (t: Task) => (
    <button
      className={"task-row " + (selected === t.id ? "selected" : "")}
      key={t.id}
      onClick={() => choose(t.id)}
    >
      <span className={"status-dot " + t.status} />
      <span className="grow">
        <strong>{title(t)}</strong>
        <small>
          {t.deviceId || "local"} · {t.provider} · {time(t.updatedAt)}
        </small>
      </span>
      <ChevronRight size={15} />
    </button>
  );
  return (
    <div className="app">
      <main>
        <header>
          <div className="breadcrumb">
            {selected !== "assistant" && (
              <button onClick={() => choose("assistant")}>
                <Sparkles size={16} /> Asistana dön
              </button>
            )}
          </div>
          <div className="header-actions">
            <button onClick={() => setModal("jobs")} aria-label="İşler">
              <Layers size={16} /> İşler{" "}
              {active.length > 0 && (
                <span className="count">{active.length}</span>
              )}
            </button>
            <button
              className="header-voice"
              onClick={() => {
                stopVoice(false);
                setModal("voice");
                setVoiceState("idle");
              }}
            >
              <Mic size={16} /> Sesli asistan
            </button>

            <span className="today">
              {new Date().toLocaleDateString("tr", {
                day: "numeric",
                month: "long",
                weekday: "long",
              })}
            </span>
            <button
              className="icon"
              title="Ayrıntı paneli"
              aria-label="Ayrıntı paneli"
              onClick={() => setInspector(!inspector)}
            >
              <PanelRight size={18} />
            </button>
            <button className="new-button" onClick={() => setModal("new")}>
              <Plus size={15} />
              Yeni oturum
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button aria-label="Uyarıyı kapat" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!connected ? (
          <div className="onboarding">
            <div className="hero-mark">
              <Sparkles size={38} />
            </div>

            <h1>Çalışma alanına bağlan</h1>
            <p>
              Telefondaki asistanın, oturumların ve alt ajanların.
              <br />
              Devam etmek için bilgisayarını bağla.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void work(() => connect(true))}
            >
              Bu Mac’e bağlan
              <ChevronRight size={17} />
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void work(() => connect(false))}
            >
              Başka bilgisayardan bağlantı dosyası seç
            </button>
            <small>Mevcut Agent Workspace sunucusunu kullanır.</small>
          </div>
        ) : (
          <div className={"workspace " + (!inspector ? "wide" : "")}>
            <section className="conversation">
              {selected !== "assistant" && (
                <div className="chat-heading">
                  <div className="inline">
                    <div className="assistant-mark">
                      <Sparkles size={22} />
                    </div>
                    <div>
                      <h2 title={heading}>{heading}</h2>
                      <small>
                        {selected === "assistant"
                          ? "İşleri başlat, gelişmeleri takip et."
                          : external
                            ? "Terminal geçmişi"
                            : task?.provider + " oturumu"}
                      </small>
                    </div>
                  </div>
                  {task && <Badge task={task} />}
                </div>
              )}
              <div
                className="messages"
                ref={scroll}
                onScroll={() => {
                  const el = scroll.current!;
                  nearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                }}
              >
                {(older || nativeHistoryCursor) && (
                  <button
                    className="load-older"
                    disabled={busy}
                    onClick={() =>
                      void work(() =>
                        external
                          ? loadNativeMessages(external, true)
                          : load(snap, older!),
                      )
                    }
                  >
                    Önceki mesajları yükle
                  </button>
                )}
                {!messages.length ? (
                  <div className="chat-empty">
                    <Sparkles size={30} />
                    <h2>Bugün neyi ilerletelim?</h2>
                    <p>
                      Bir iş ver, bir fikir paylaş veya araştırmamı istediğin
                      konuyu söyle.
                    </p>
                    <div className="suggestions">
                      {[
                        "Aktif işlerimi özetle",
                        "Bugün önceliklerimiz neler?",
                        "Yeni bir konuyu araştıralım",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setDrafts((d) => ({ ...d, [selected]: s }));
                            composer.current?.focus();
                          }}
                        >
                          {s}
                          <ArrowUp size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((m) => (
                      <React.Fragment key={m.id}>
                        {groupedWork.before.get(m.id)?.map((group: any) => (
                          <WorkGroup key={group.id} run={group} />
                        ))}
                        <article className={"message " + m.role}>
                          <div className="message-body">
                            <Markdown
                              urlTransform={(url) =>
                                url.startsWith("file:")
                                  ? url
                                  : /^(https?:|mailto:|\/|#)/i.test(url)
                                    ? url
                                    : ""
                              }
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (href)
                                        void work(async () => {
                                          if (
                                            href.startsWith("/") ||
                                            href.startsWith("file:")
                                          ) {
                                            const file = await request(
                                              "/v1/artifacts/open",
                                              {
                                                path: href,
                                                deviceId:
                                                  task?.deviceId ||
                                                  external?.deviceId ||
                                                  snap.localDeviceId,
                                              },
                                            );
                                            if (
                                              !/\.(html?|pdf|png|jpe?g|webp|gif|txt|md|markdown|json|csv|log|ts|tsx|js|jsx|py|css|yaml|yml|xml)$/i.test(
                                                file.name,
                                              ) ||
                                              file.size > 5 * 1024 * 1024
                                            ) {
                                              await window.desktop.saveAttachment(
                                                file.id,
                                              );
                                            } else
                                              setPreview(
                                                file.content === undefined
                                                  ? await request(
                                                      "/v1/attachments/" +
                                                        file.id,
                                                    )
                                                  : file,
                                              );
                                          } else
                                            await window.desktop.openLink(href);
                                        });
                                    }}
                                  >
                                    {children}
                                  </a>
                                ),
                                img: ({ alt }) => (
                                  <span className="quiet">[Görsel: {alt}]</span>
                                ),
                              }}
                            >
                              {m.text}
                            </Markdown>
                            {m.attachments?.map((a) => (
                              <button
                                className="attachment"
                                key={a.id}
                                onClick={() =>
                                  void work(async () =>
                                    setPreview(
                                      await request("/v1/attachments/" + a.id),
                                    ),
                                  )
                                }
                              >
                                <FileText size={17} />
                                {a.name}
                                <ChevronRight size={14} />
                              </button>
                            ))}
                          </div>
                          <div className="message-actions">
                            <CopyMessage text={m.text} />
                            {m.role === "assistant" &&
                              selected === "assistant" && (
                                <button
                                  aria-label="Yanıtı seslendir"
                                  title="Yanıtı seslendir"
                                  onClick={() => void work(() => speak(m))}
                                >
                                  <Volume2 size={13} />
                                  Seslendir
                                </button>
                              )}
                          </div>
                          {m.created && (
                            <time
                              className="message-time"
                              dateTime={new Date(m.created).toISOString()}
                            >
                              {time(m.created)}
                            </time>
                          )}
                        </article>
                      </React.Fragment>
                    ))}
                  </>
                )}
                {!external &&
                  groupedWork.tail.map((group: any) => (
                    <WorkGroup key={group.id} run={group} />
                  ))}
                {(snap.queuedMessages ?? [])
                  .filter(
                    (q) =>
                      q.taskId === task?.id &&
                      !q.text.startsWith("Background task event"),
                  )
                  .map((q) => (
                    <aside key={q.id} className="queued-message" role="status">
                      <span>
                        Sırada · {q.text.split("\n")[0].slice(0, 160)}
                      </span>
                      {task?.provider === "codex" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void work(async () => {
                              await request("/v1/messages/steer", {
                                taskId: q.taskId,
                                commandId: q.id,
                                clientRequestId: "steer:" + q.id,
                              });
                            })
                          }
                        >
                          Şimdi yönlendir
                        </button>
                      )}
                    </aside>
                  ))}
              </div>
              {task?.question && (
                <form
                  className="question"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      await request("/v1/task/action", {
                        taskId: task.id,
                        action: "answer",
                        questionId: task.question!.id,
                        answer: answers,
                        clientRequestId: uid(),
                      });
                      setAnswers({});
                      await refresh();
                    });
                  }}
                >
                  <strong>Devam etmek için sana ihtiyacım var</strong>
                  {task.question.prompt.questions?.map((q) => (
                    <label key={q.id}>
                      {q.question}
                      <input
                        required
                        value={answers[q.id] || ""}
                        placeholder={q.options?.map((o) => o.label).join(" / ")}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                  <button className="primary" disabled={busy}>
                    Yanıtı gönder
                  </button>
                </form>
              )}
              <div className="composer-wrap">
                {!external &&
                  !(
                    progress.kind === "idle" && task?.status === "completed"
                  ) && (
                    <div
                      className={"chat-progress " + progress.kind}
                      role="status"
                      aria-live="polite"
                      data-testid="chat-progress"
                    >
                      {progress.animated ? (
                        <Loader2 size={18} className="progress-spinner" />
                      ) : progress.kind === "warning" ? (
                        <AlertCircle size={18} />
                      ) : (
                        <CheckCircle2 size={18} />
                      )}
                      <div>
                        <strong>{progress.label}</strong>
                        <small>{progress.detail}</small>
                      </div>
                      {task?.deviceId && (
                        <span className="progress-device">
                          {snap.devices?.find((d) => d.id === task.deviceId)
                            ?.name || task.deviceId}
                        </span>
                      )}
                    </div>
                  )}
                {external && (
                  <label className="external-confirm">
                    <input
                      type="checkbox"
                      checked={nativeConfirmed}
                      onChange={(e) => setNativeConfirmed(e.target.checked)}
                    />
                    Bu oturumun terminalde aktif çalışmadığını doğruladım.
                  </label>
                )}
                <form
                  className={"composer" + (draggingFiles ? " drop-target" : "")}
                  onDragOver={(e) => {
                    if (Array.from(e.dataTransfer.types).includes("Files")) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = busy ? "none" : "copy";
                      setDraggingFiles(!busy);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDraggingFiles(false);
                  }}
                  onDrop={(e) => {
                    const incoming = transferredFiles(e.dataTransfer);
                    if (!incoming.length) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDraggingFiles(false);
                    if (!busy) void work(() => upload(incoming));
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(send);
                  }}
                >
                  <textarea
                    ref={composer}
                    onPaste={(e) => {
                      const incoming = transferredFiles(e.clipboardData);
                      if (!incoming.length) return;
                      e.preventDefault();
                      if (!busy) void work(() => upload(incoming));
                    }}
                    aria-label="Mesaj"
                    placeholder="Bir mesaj yaz veya bir iş ver…"
                    value={draft}
                    disabled={busy}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [selected]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void work(send);
                      }
                    }}
                  />
                  {draggingFiles && (
                    <div className="drop-hint" role="status">
                      Dosyaları eklemek için bırak
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="file-chips">
                      {files.map((f) => (
                        <span
                          key={f.id}
                          className={f.thumbnail ? "image-chip" : ""}
                        >
                          {f.thumbnail ? (
                            <img
                              src={f.thumbnail}
                              alt={f.name}
                              title={f.name}
                            />
                          ) : (
                            <>
                              <FileText size={14} />
                              {f.name}
                            </>
                          )}
                          <button
                            type="button"
                            aria-label={f.name + " kaldır"}
                            onClick={() =>
                              setFiles((fs) => fs.filter((a) => a.id !== f.id))
                            }
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="composer-tools">
                    {!external && (
                      <ModelPicker
                        deviceId={task?.deviceId || snap.localDeviceId}
                        value={
                          selections[selected] ||
                          (task?.model
                            ? {
                                provider: task.provider as "codex" | "claude",
                                model: task.model,
                                effort: task.effort,
                              }
                            : undefined)
                        }
                        onChange={(value) =>
                          setSelections((s) => ({ ...s, [selected]: value }))
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="dictation-button"
                      title={
                        voiceState === "recording"
                          ? "Dikteyi bitir"
                          : "Dikte — taslağa yaz"
                      }
                      aria-label="Dikte — taslağa yaz"
                      aria-pressed={voiceState === "recording"}
                      disabled={
                        voiceState === "sending" || voiceState === "starting"
                      }
                      onClick={() =>
                        voiceState === "recording"
                          ? stopVoice(true)
                          : void startVoice(true)
                      }
                    >
                      <Mic size={16} />
                    </button>
                    <div>
                      <input
                        ref={fileInput}
                        type="file"
                        hidden
                        multiple
                        accept=".txt,.md,.json,.csv,.log,.ts,.js,.py,.html,.pdf,.png,.jpg,.jpeg,.webp"
                        onChange={(e) =>
                          void work(() => upload(e.target.files))
                        }
                      />
                      <button
                        type="button"
                        className="icon"
                        title="Dosya ekle"
                        aria-label="Dosya ekle"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip size={18} />
                      </button>
                    </div>
                    <button
                      className="send"
                      disabled={
                        busy ||
                        !draft.trim() ||
                        (!!external && !nativeConfirmed)
                      }
                      aria-label="Gönder"
                    >
                      {deliveries[selected]?.phase === "sending" ? (
                        <Loader2 size={20} className="progress-spinner" />
                      ) : (
                        <ArrowUp size={20} />
                      )}
                    </button>
                  </div>
                </form>
                <div className="composer-caption">
                  <span>
                    <kbd>↵</kbd> gönder · <kbd>⇧ ↵</kbd> yeni satır
                  </span>
                  <span>İşler arka planda devam eder.</span>
                </div>
              </div>
            </section>
            {inspector && (
              <aside className="inspector">
                <div className="section-heading">
                  <h3>
                    <Activity size={16} />
                    Çalışma akışı
                  </h3>
                  <span className="count">{active.length}</span>
                </div>
                <p className="quiet">
                  Sohbet devam ederken işlerin burada ilerler.
                </p>
                {(selected === "assistant" ? active : children).map(row)}
                {!(selected === "assistant" ? active : children).length && (
                  <div className="inspector-empty">
                    <CheckCircle2 size={25} />
                    <h4>Aktif iş yok.</h4>
                    <p>
                      Yeni bir iş başladığında
                      <br />
                      ilerlemesini burada göreceksin.
                    </p>
                  </div>
                )}
                {task && (
                  <div className="detail-card">
                    <span className="eyebrow">OTURUM AYRINTILARI</span>
                    <dl>
                      <dt>Cihaz</dt>
                      <dd>
                        {snap.devices?.find((d) => d.id === task?.deviceId)
                          ?.name ||
                          task?.deviceId ||
                          "Bu bilgisayar"}
                      </dd>
                      <dt>Sağlayıcı</dt>
                      <dd>{task.provider}</dd>
                      <dt>Son hareket</dt>
                      <dd>{time(task.updatedAt)}</dd>
                      <dt>Durum</dt>
                      <dd>{labels[task.status] || task.status}</dd>
                    </dl>
                    {task.parentTaskId && (
                      <button
                        className="text-button"
                        onClick={() => choose(task.parentTaskId!)}
                      >
                        Üst göreve git
                      </button>
                    )}
                    {isActive(task) && (
                      <button
                        className="cancel-button"
                        onClick={() => setModal("cancel")}
                      >
                        <Square size={13} />
                        İşi ve alt görevleri durdur
                      </button>
                    )}
                  </div>
                )}
                <div className="inspector-bottom">
                  <button
                    className="rail-action"
                    onClick={() => setModal("sessions")}
                  >
                    <MessageSquare size={17} /> Oturumlar
                  </button>
                  <UsageLimits
                    deviceId={task?.deviceId || snap.localDeviceId}
                    connected={connected && !offline}
                  />
                  <button
                    className="rail-action"
                    onClick={() => setModal("settings")}
                  >
                    <Settings size={17} /> Ayarlar
                  </button>
                </div>
              </aside>
            )}
          </div>
        )}
      </main>
      {(modal || preview) && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setModal("");
              setPreview(null);
              stopVoice(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "sessions"
                ? "Oturumlar"
                : modal === "jobs"
                  ? "İşler"
                  : modal === "settings"
                    ? "Ayarlar"
                    : modal === "voice"
                      ? "Sesli asistan"
                      : preview
                        ? "Dosya önizleme"
                        : "Çalışma alanı işlemi"
            }
            className={
              "modal " + (modal === "jobs" ? "jobs-modal " : "") +
              (modal === "voice"
                ? "voice-modal"
                : preview
                  ? "attachment-modal"
                  : "")
            }
          >
            <button
              className="modal-close icon"
              aria-label="Kapat"
              onClick={() => {
                setModal("");
                setPreview(null);
                stopVoice(false);
                audio.current?.pause();
              }}
            >
              <X size={20} />
            </button>
            {modal === "jobs" && (
              <div className="page">
                <div className="page-title">
                  <div>
                    <h1>İşler</h1>
                    <p>
                      Devam eden işleri takip et, ihtiyaç duyduklarında yön ver.
                    </p>
                  </div>
                  <span className="metric">
                    {active.length}
                    <small>aktif iş</small>
                  </span>
                </div>
                <div className="task-tree">
                  {taskTree(
                    snap.tasks.filter((t) => !!t.parentTaskId),
                    snap.assistantId,
                  ).map(({ task: t, depth, path, childCount }: any) => (
                    <button
                      className={"job-card tree-job " + (depth ? "nested" : "")}
                      style={{ marginLeft: Math.min(depth, 6) * 24 }}
                      key={t.id}
                      onClick={() => choose(t.id)}
                    >
                      <small className="tree-path" title={path.join(" → ")}>
                        {path.join(" → ")}
                      </small>
                      <h3>{title(t)}</h3>
                      <div>
                        <Badge task={t} />
                        <span className="quiet">
                          {t.provider} · {t.deviceId || "yerel"}
                          {childCount > 0 ? ` · ${childCount} alt görev` : ""}
                        </span>
                        <span className="quiet">{date(t.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                  {!snap.tasks.some((t) => !!t.parentTaskId) && (
                    <p>Henüz iş yok.</p>
                  )}
                </div>
              </div>
            )}
            {modal === "sessions" && (
              <>
                <h2>Oturumlar</h2>
                <input
                  ref={search}
                  autoFocus
                  placeholder="Workspace oturumlarında ara…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="session-list">
                  <button onClick={() => choose("assistant")}>
                    <Sparkles size={20} />
                    <span className="grow">
                      <strong>Asistan</strong>
                      <small>Kalıcı sohbet</small>
                    </span>
                  </button>
                  {filtered
                    .filter((t) => t.id !== snap.assistantId && !t.parentTaskId)
                    .map(row)}
                  {!filtered.some(
                    (t) => t.id !== snap.assistantId && !t.parentTaskId,
                  ) && <p className="quiet">Henüz başka oturum yok.</p>}
                </div>
              </>
            )}
            {modal === "new" && (
              <>
                <span className="eyebrow">YENİ BİR BAŞLANGIÇ</span>
                <h2>Bir oturum aç.</h2>
                <label>
                  Çalışacağı cihaz
                  <select
                    aria-label="Çalışacağı cihaz"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                  >
                    {snap.devices?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.id === snap.defaultDeviceId ? " · varsayılan" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p>İlk mesajınla çalışmaya başlasın.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      const r = await request("/v1/sessions/messages", {
                        provider,
                        deviceId: deviceId || snap.defaultDeviceId,
                        model: model.trim() || undefined,
                        text: newText,
                        clientRequestId: uid(),
                      });
                      setNewText("");
                      setModal("");
                      await refresh();
                      navigate("sessions");
                      if (r.taskId) choose(r.taskId);
                    });
                  }}
                >
                  <label>
                    Sağlayıcı
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      <option value="codex">Codex</option>
                      <option value="claude">Claude Code</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Sağlayıcının varsayılan modeli"
                    />
                  </label>
                  <label>
                    Ne üzerinde çalışalım?
                    <textarea
                      required
                      rows={5}
                      value={newText}
                      onChange={(e) => setNewText(e.target.value)}
                      placeholder="Görevi ve beklediğin sonucu anlat…"
                    />
                  </label>
                  <button className="primary" disabled={busy || !connected}>
                    Oturumu başlat
                    <ArrowUp size={16} />
                  </button>
                </form>
              </>
            )}
            {modal === "settings" && (
              <>
                <h2>Ayarlar</h2>
                <AppearanceSettings />
                <div className="settings-card">
                  <strong>Bilgisayar bağlantısı</strong>
                  <p>{origin || "Henüz bağlı değil"}</p>
                  <div className="inline">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void work(() => connect(true))}
                    >
                      Bu Mac’e bağlan
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void work(() => connect(false))}
                    >
                      Dosyadan bağlan
                    </button>
                  </div>
                  <small>
                    Anahtar macOS güvenli deposuyla şifrelenir. Sohbet içeriğine
                    eklenmez.
                  </small>
                </div>
                <div className="settings-card">
                  <strong>Sesli asistan</strong>
                  <p>
                    Mobil uygulamayla aynı ElevenLabs bağlantısını kullanır.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy || !connected}
                    onClick={() =>
                      void work(async () => {
                        const [r, s] = await Promise.all([
                          request("/v1/voice/voices"),
                          request("/v1/voice/status"),
                        ]);
                        setVoices(r.voices);
                        setVoiceId(s.voiceId || "");
                      })
                    }
                  >
                    Sesleri getir
                  </button>
                  {voices.length > 0 && (
                    <select
                      aria-label="Asistan sesi"
                      value={voiceId}
                      onChange={(e) => {
                        setVoiceId(e.target.value);
                        void work(async () => {
                          await request("/v1/voice/config", {
                            voiceId: e.target.value,
                          });
                        });
                      }}
                    >
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {connected && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      void work(async () => {
                        epoch.current++;
                        await window.desktop.disconnect();
                        setConnected(false);
                        setSnap(empty);
                        setMessages([]);
                        setEvents([]);
                        setDrafts({});
                        setFiles([]);
                        setOrigin("");
                        setModal("");
                      })
                    }
                  >
                    Bu Mac’teki bağlantıyı kaldır
                  </button>
                )}
                <p className="quiet">Agent Workspace · Mac 0.1.0</p>
              </>
            )}
            {modal === "cancel" && (
              <>
                <h2>Bu işi durdur?</h2>
                <p>
                  Seçili iş ve ona bağlı alt görevler iptal edilir. Geçmiş
                  mesajlar korunur.
                </p>
                <button
                  className="primary danger-bg"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      await request("/v1/task/action", {
                        taskId: task!.id,
                        action: "cancel",
                        clientRequestId: uid(),
                      });
                      setModal("");
                      await refresh();
                    })
                  }
                >
                  İşi ve alt görevleri durdur
                </button>
              </>
            )}
            {modal === "voice" && (
              <>
                <span className="eyebrow">SESLİ ASİSTAN</span>
                <div className={"orb " + voiceState}>
                  <Sparkles size={54} />
                </div>
                <h2>
                  {voiceState === "recording"
                    ? "Seni dinliyorum."
                    : voiceState === "sending"
                      ? "Asistanına iletiyorum…"
                      : voiceState === "speaking"
                        ? "Asistanın konuşuyor."
                        : voiceState === "sent"
                          ? "Yanıt bekleniyor…"
                          : "Aklındakini söyle."}
                </h2>
                <p>
                  {voiceState === "recording"
                    ? voiceElapsed + " / 30 saniye"
                    : "Aynı asistan. Bu kez, sesinle."}
                </p>
                <button
                  className="secondary"
                  aria-pressed={speakerMuted}
                  onClick={() => {
                    audio.current?.pause();
                    setSpeakerMuted((v) => !v);
                    if (voiceState === "speaking") setVoiceState("idle");
                  }}
                >
                  <Volume2 size={16} />
                  {speakerMuted ? "Yanıt sesini aç" : "Yanıt sesini kapat"}
                </button>
                <label className="microphone-picker">
                  Mikrofon
                  <select
                    aria-label="Mikrofon"
                    value={micId}
                    disabled={["starting", "recording", "sending"].includes(
                      voiceState,
                    )}
                    onFocus={() =>
                      void navigator.mediaDevices
                        .enumerateDevices()
                        .then((ds) =>
                          setMicrophones(
                            ds.filter((d) => d.kind === "audioinput"),
                          ),
                        )
                        .catch(fail)
                    }
                    onChange={(e) => setMicId(e.target.value)}
                  >
                    <option value="">Sistem varsayılanı</option>
                    {microphones
                      .filter((d) => d.deviceId !== "default")
                      .map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Mikrofon " + (i + 1)}
                        </option>
                      ))}
                  </select>
                </label>
                {voiceState === "recording" && (
                  <div className="mic-meter">
                    <meter
                      aria-label="Mikrofon ses seviyesi"
                      min={0}
                      max={1}
                      value={micLevel}
                    />
                    <small>
                      {micLevel > 0.01
                        ? "Ses alınıyor"
                        : "Ses bekleniyor — gösterge hareket etmiyorsa mikrofonu kontrol et."}
                    </small>
                  </div>
                )}
                <div className="inline voice-controls">
                  {voiceState === "recording" ? (
                    <>
                      <button
                        className="secondary"
                        onClick={() => stopVoice(false)}
                      >
                        <X size={18} />
                        Vazgeç
                      </button>
                      <button
                        className="primary"
                        onClick={() => stopVoice(true)}
                      >
                        <ArrowUp size={18} />
                        Gönder
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={["starting", "sending"].includes(voiceState)}
                      onClick={() => void startVoice()}
                    >
                      <Mic size={19} />
                      {voiceState === "starting"
                        ? "Mikrofon açılıyor…"
                        : "Konuşmaya başla"}
                    </button>
                  )}
                </div>
                <small>
                  Mikrofon yalnızca sen başlattığında açılır.
                  <br />
                  Kaydı gönderdiğinde ElevenLabs üzerinden yazıya çevrilir.
                </small>
              </>
            )}
            {preview && (
              <>
                <span className="eyebrow">EKLİ DOSYA</span>
                <h2>{preview.name}</h2>
                <AttachmentPreview key={preview.id} file={preview} />
                <button
                  className="primary"
                  onClick={() =>
                    void work(async () => {
                      await window.desktop.saveAttachment(preview.id);
                    })
                  }
                >
                  <Download size={16} />
                  Dosyayı kaydet
                </button>
                <button
                  onClick={() =>
                    void work(() => window.desktop.openAttachment(preview.id))
                  }
                >
                  Mac uygulamasında aç
                </button>
              </>
            )}
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
