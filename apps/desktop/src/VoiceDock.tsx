import React from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  ArrowUp,
  Loader2,
} from "lucide-react";
export function VoiceDock({
  state,
  elapsed,
  level,
  muted,
  microphones,
  micId,
  onMicId,
  onDevices,
  onStart,
  onStop,
  onMute,
  onClose,
}: {
  state: string;
  elapsed: number;
  level: number;
  muted: boolean;
  microphones: MediaDeviceInfo[];
  micId: string;
  onMicId: (id: string) => void;
  onDevices: () => void;
  onStart: () => void;
  onStop: (send: boolean) => void;
  onMute: () => void;
  onClose: () => void;
}) {
  const recording = state === "recording";
  const pending = state === "starting" || state === "sending";
  const label = recording
    ? "Seni dinliyorum"
    : state === "speaking"
      ? "Asistan konuşuyor"
      : state === "sending"
        ? "Mesajın iletiliyor"
        : state === "sent"
          ? "Yanıt bekleniyor"
          : state === "starting"
            ? "Mikrofon açılıyor"
            : "Konuşmaya hazır";
  return (
    <aside className={"voice-dock " + state} aria-label="Sesli asistan paneli">
      <div className="voice-dock-header">
        <span>Sesli asistan</span>
        <button
          className="icon"
          title="Sesli asistanı kapat"
          aria-label="Sesli asistanı kapat"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="voice-dock-stage">
        <div
          className="voice-sphere"
          aria-hidden="true"
          style={{ "--voice-level": level } as React.CSSProperties}
        >
          <div className="voice-cloud one" />
          <div className="voice-cloud two" />
          <div className="voice-cloud three" />
        </div>
        <div className="voice-dock-status" role="status">
          <strong>{label}</strong>
          <span>
            {recording ? `${elapsed} / 30 saniye` : "Kalıcı asistanınla konuş"}
          </span>
        </div>
        {recording && (
          <meter
            aria-label="Mikrofon ses seviyesi"
            min={0}
            max={1}
            value={level}
          />
        )}
      </div>
      <div className="voice-dock-footer">
        <div className="voice-dock-controls">
          <button
            className={"voice-round " + (recording ? "live" : "")}
            disabled={pending}
            title={
              recording ? "Mikrofonu kapat ve kaydı sil" : "Konuşmaya başla"
            }
            aria-label={
              recording ? "Mikrofonu kapat ve kaydı sil" : "Konuşmaya başla"
            }
            aria-pressed={recording}
            onClick={() => (recording ? onStop(false) : onStart())}
          >
            {pending ? (
              <Loader2 className="progress-spinner" size={21} />
            ) : recording ? (
              <MicOff size={21} />
            ) : (
              <Mic size={21} />
            )}
          </button>
          {recording && (
            <button
              className="voice-round voice-send"
              aria-label="Sesli mesajı gönder"
              title="Sesli mesajı gönder"
              onClick={() => onStop(true)}
            >
              <ArrowUp size={22} />
            </button>
          )}
          <button
            className="voice-round"
            aria-label={muted ? "Yanıt sesini aç" : "Yanıt sesini kapat"}
            title={muted ? "Yanıt sesini aç" : "Yanıt sesini kapat"}
            aria-pressed={muted}
            onClick={onMute}
          >
            {muted ? <VolumeX size={21} /> : <Volume2 size={21} />}
          </button>
        </div>
        <label className="voice-input-select">
          <span>Mikrofon</span>
          <select
            aria-label="Sesli asistan mikrofonu"
            value={micId}
            disabled={pending || recording}
            onFocus={onDevices}
            onChange={(e) => onMicId(e.target.value)}
          >
            <option value="">Sistem varsayılanı</option>
            {microphones
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mikrofon ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
        <small>
          {recording
            ? "Gönder düğmesiyle ilet. Mikrofon düğmesi kaydı siler."
            : "Mikrofon yalnızca sen başlattığında açılır."}
        </small>
      </div>
    </aside>
  );
}
