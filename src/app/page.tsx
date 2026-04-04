"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type PodcastScript,
  type VoiceSegmentTiming,
  type GenerationStep,
} from "@/lib/types";

const SUGGESTED_TOPICS = [
  "Why cats think they own the internet",
  "The future of AI in music production",
  "Should pineapple go on pizza?",
  "How to survive a zombie apocalypse",
  "The psychology of doomscrolling",
  "Space tourism: who goes first?",
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [step, setStep] = useState<GenerationStep>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [script, setScript] = useState<PodcastScript | null>(null);
  const [introAudio, setIntroAudio] = useState<string>("");
  const [dialogueAudio, setDialogueAudio] = useState<string>("");
  const [voiceSegments, setVoiceSegments] = useState<VoiceSegmentTiming[]>([]);
  const [currentSegment, setCurrentSegment] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [podcastId, setPodcastId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<"casual" | "educational" | "debate" | "comedy">("casual");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [sourceUrl, setSourceUrl] = useState("");
  const [cloneVoiceId, setCloneVoiceId] = useState<string | null>(null);
  const [cloneStatus, setCloneStatus] = useState<"idle" | "recording" | "uploading" | "done">("idle");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<HTMLElement>(null);

  // Set up audio element when dialogue audio changes
  useEffect(() => {
    if (!dialogueAudio) return;

    const audio = new Audio(`data:audio/mpeg;base64,${dialogueAudio}`);
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setPlaybackTime(audio.currentTime);
      const idx = voiceSegments.findIndex(
        (seg) =>
          audio.currentTime >= seg.startTime && audio.currentTime < seg.endTime
      );
      if (idx !== -1) setCurrentSegment(idx);
    };

    const onLoaded = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentSegment(-1);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeAttribute("src");
    };
  }, [dialogueAudio, voiceSegments]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await uploadVoiceClone(blob);
      };

      recorder.start();
      setIsRecording(true);
      setCloneStatus("recording");

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch {
      setCloneStatus("idle");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const uploadVoiceClone = useCallback(async (audioBlob: Blob) => {
    setCloneStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice-sample.webm");

      const res = await fetch("/api/clone-voice", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.voiceId) {
        setCloneVoiceId(data.voiceId);
        setCloneStatus("done");
      } else {
        throw new Error(data.error || "Clone failed");
      }
    } catch {
      setCloneStatus("idle");
      setCloneVoiceId(null);
    }
  }, []);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await uploadVoiceClone(file);
    },
    [uploadVoiceClone]
  );

  const generate = useCallback(async (overrideTopic?: string) => {
    const finalTopic = overrideTopic ?? topic;
    if (!finalTopic.trim()) return;
    if (overrideTopic) setTopic(overrideTopic);

    setStep("script");
    setStatusMessage("Writing your podcast script...");
    setScript(null);
    setIntroAudio("");
    setDialogueAudio("");
    setVoiceSegments([]);
    setCurrentSegment(-1);
    setIsPlaying(false);
    setPlaybackTime(0);
    setDuration(0);
    setError("");
    setPodcastId(null);
    window.history.replaceState(null, "", window.location.pathname);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: finalTopic,
          tone,
          length,
          sourceUrl: sourceUrl.trim() || undefined,
          cloneVoiceId: cloneVoiceId || undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          switch (data.step) {
            case "script":
              setStep("script");
              setStatusMessage(data.message);
              break;
            case "script_done":
              setScript(data.script);
              break;
            case "voices":
              setStep("voices");
              setStatusMessage(data.message);
              break;
            case "voices_done":
              break;
            case "audio":
              setStep("audio");
              setStatusMessage(data.message);
              break;
            case "done": {
              const id = Math.random().toString(36).slice(2, 10);
              setScript(data.script);
              setDialogueAudio(data.dialogueAudioBase64);
              setVoiceSegments(data.voiceSegments);
              if (data.introAudioBase64) setIntroAudio(data.introAudioBase64);
              setPodcastId(id);
              setStep("done");
              setStatusMessage("");
              try {
                localStorage.setItem(
                  `voicecast:${id}`,
                  JSON.stringify({
                    script: data.script,
                    dialogueAudioBase64: data.dialogueAudioBase64,
                    voiceSegments: data.voiceSegments,
                    introAudioBase64: data.introAudioBase64 || null,
                  })
                );
                window.history.replaceState(null, "", `?ep=${id}`);
              } catch {}
              break;
            }
            case "error":
              setStep("error");
              setError(data.error);
              break;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setStep("error");
      setError(err instanceof Error ? err.message : "Generation failed");
    }
  }, [topic]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const seekToSegment = useCallback(
    (index: number) => {
      if (!audioRef.current || !voiceSegments[index]) return;
      audioRef.current.currentTime = voiceSegments[index].startTime;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    },
    [voiceSegments, isPlaying]
  );

  const seekToTime = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      audioRef.current.currentTime = ratio * duration;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    },
    [duration, isPlaying]
  );

  const downloadPodcast = useCallback(() => {
    if (!dialogueAudio) return;
    const decode = (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    };
    const parts: Uint8Array[] = [];
    if (introAudio) parts.push(decode(introAudio));
    parts.push(decode(dialogueAudio));
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    const blob = new Blob([merged], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `voicecast-${script?.title || "podcast"}.mp3`;
    link.click();
    URL.revokeObjectURL(url);
  }, [dialogueAudio, introAudio, script]);

  const copyLink = useCallback(async () => {
    if (!podcastId) return;
    const url = `${window.location.origin}${window.location.pathname}?ep=${podcastId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [podcastId]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      abortRef.current?.abort();
    };
  }, []);

  // Auto-scroll to player when generation completes
  useEffect(() => {
    if (step === "done" && playerRef.current) {
      setTimeout(() => {
        playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [step]);

  // Auto-scroll transcript to active segment
  useEffect(() => {
    if (currentSegment < 0) return;
    const el = document.querySelector(`[data-segment="${currentSegment}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentSegment]);

  // Load from localStorage on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("ep");
    if (id) {
      try {
        const saved = localStorage.getItem(`voicecast:${id}`);
        if (saved) {
          const data = JSON.parse(saved);
          setScript(data.script);
          setDialogueAudio(data.dialogueAudioBase64);
          setVoiceSegments(data.voiceSegments);
          if (data.introAudioBase64) setIntroAudio(data.introAudioBase64);
          setPodcastId(id);
          setStep("done");
        }
      } catch {}
    }
  }, []);

  const isGenerating = step !== "idle" && step !== "done" && step !== "error";

  return (
    <main className="min-h-screen flex flex-col relative overflow-hidden font-[family-name:var(--font-body)]">
      {/* ─────────── HERO ─────────── */}
      <section className="relative z-10">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-10 sm:pb-14">
          {/* Title */}
          <div className="animate-fade-up stagger-1 text-center sm:text-left mb-3">
            <h1 className="font-[family-name:var(--font-display)] text-5xl sm:text-6xl lg:text-7xl leading-[1] text-[var(--text-primary)]">
              VoiceCast
            </h1>
          </div>

          {/* Subtitle */}
          <p className="animate-fade-up stagger-2 text-center sm:text-left text-[13px] text-[var(--text-muted)] max-w-xs leading-relaxed mb-10 sm:mb-12">
            Topic in, podcast out. AI-designed voices, full transcript.
          </p>

          {/* ── Input ── */}
          <div className="animate-fade-up stagger-3">
            <div className="space-y-2">
              <div className="relative flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isGenerating) generate();
                    }}
                    placeholder="Topic — e.g. &quot;The future of remote work&quot;"
                    disabled={isGenerating}
                    className="w-full px-5 py-4 sm:py-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/40 focus:shadow-[0_0_0_3px_rgba(232,137,12,0.06)] disabled:opacity-40 text-sm sm:text-base transition-all"
                  />
                </div>
              <button
                onClick={() => generate()}
                disabled={isGenerating || !topic.trim()}
                className="group relative px-7 py-4 sm:py-3.5 rounded-xl font-medium text-sm sm:text-base transition-all disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
                style={{
                  background: isGenerating
                    ? "var(--bg-elevated)"
                    : "#111111",
                  color: isGenerating ? "var(--text-muted)" : "#FFFFFF",
                }}
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <svg
                      className="animate-spin h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-20"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-80"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Generating...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Generate
                    <svg
                      className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M13 7l5 5m0 0l-5 5m5-5H6"
                      />
                    </svg>
                  </span>
                )}
              </button>
              </div>
              {/* URL source — optional */}
              <div className="relative">
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="Paste a URL to base the podcast on (optional)"
                  disabled={isGenerating}
                  className="w-full px-5 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500/40 focus:shadow-[0_0_0_3px_rgba(232,137,12,0.06)] disabled:opacity-40 text-[13px] transition-all"
                />
                {sourceUrl && (
                  <button
                    onClick={() => setSourceUrl("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xs"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>

            {/* Controls — tone & length */}
            {step === "idle" && (
              <div className="mt-5 space-y-3">
                {/* Tone */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-medium w-12 shrink-0">Tone</span>
                  <div className="flex gap-1.5">
                    {(["casual", "educational", "debate", "comedy"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTone(t)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                        style={{
                          background: tone === t ? "#111111" : "transparent",
                          color: tone === t ? "#FFFFFF" : "var(--text-muted)",
                          border: tone === t ? "1px solid #111111" : "1px solid var(--border-subtle)",
                        }}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Length */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-medium w-12 shrink-0">Length</span>
                  <div className="flex gap-1.5">
                    {([
                      { value: "short" as const, label: "Short", sub: "~2 min" },
                      { value: "medium" as const, label: "Medium", sub: "~5 min" },
                      { value: "long" as const, label: "Long", sub: "~8 min" },
                    ]).map((l) => (
                      <button
                        key={l.value}
                        onClick={() => setLength(l.value)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                        style={{
                          background: length === l.value ? "#111111" : "transparent",
                          color: length === l.value ? "#FFFFFF" : "var(--text-muted)",
                          border: length === l.value ? "1px solid #111111" : "1px solid var(--border-subtle)",
                        }}
                      >
                        {l.label} <span className="opacity-50">{l.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice clone */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-medium w-12 shrink-0">Voice</span>
                  <div className="flex items-center gap-2">
                    {cloneStatus === "done" && cloneVoiceId ? (
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#111] text-white border border-[#111]">
                          Your voice
                        </span>
                        <button
                          onClick={() => {
                            setCloneVoiceId(null);
                            setCloneStatus("idle");
                          }}
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          remove
                        </button>
                      </div>
                    ) : cloneStatus === "uploading" ? (
                      <span className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                        Cloning voice...
                      </span>
                    ) : cloneStatus === "recording" ? (
                      <button
                        onClick={stopRecording}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-red-600 text-white border border-red-600 animate-pulse"
                      >
                        Stop recording
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={startRecording}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-warm)] transition-all"
                        >
                          Record voice
                        </button>
                        <label className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-warm)] transition-all cursor-pointer">
                          Upload audio
                          <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                        </label>
                        <span className="text-[11px] text-[var(--text-muted)] opacity-60">optional</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Suggested topics */}
                <div className="-mx-5 sm:mx-0 px-5 sm:px-0 pt-2">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)] font-medium mb-2 block">Try a topic</span>
                  <div className="flex sm:flex-wrap gap-2 overflow-x-auto no-scrollbar pb-2 sm:pb-0">
                    {SUGGESTED_TOPICS.map((t, i) => (
                      <button
                        key={t}
                        onClick={() => generate(t)}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                        style={{
                          border: "1px solid var(--border-subtle)",
                          animationDelay: `${0.3 + i * 0.05}s`,
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─────────── GENERATION PROGRESS ─────────── */}
      {isGenerating && (
        <section className="relative z-10 max-w-2xl mx-auto px-5 sm:px-8 pb-10 w-full animate-fade-up">
          <div className="glass-warm rounded-2xl p-6 sm:p-8">
            {/* Status with waveform */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-end gap-[3px] h-7">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full waveform-bar"
                    style={{
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: `${0.5 + i * 0.08}s`,
                      height: "28px",
                      background:
                        i % 2 === 0 ? "var(--amber)" : "var(--teal)",
                      opacity: 0.7,
                    }}
                  />
                ))}
              </div>
              <p className="text-base text-[var(--text-secondary)]">
                {statusMessage}
              </p>
            </div>

            {/* Step progress */}
            <div className="flex gap-1.5 mb-1.5">
              {(["script", "voices", "audio"] as const).map((s, i) => {
                const stepOrder = { script: 0, voices: 1, audio: 2 };
                const currentOrder =
                  stepOrder[step as keyof typeof stepOrder] ?? -1;
                const isActive = currentOrder === i;
                const isDone = currentOrder > i;
                return (
                  <div
                    key={s}
                    className="flex-1 h-1 rounded-full transition-all duration-500"
                    style={{
                      background: isDone
                        ? "var(--amber)"
                        : isActive
                          ? "linear-gradient(90deg, var(--amber), transparent)"
                          : "var(--border-subtle)",
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-medium">
              <span>Script</span>
              <span>Voices</span>
              <span>Audio</span>
            </div>
            <p className="text-center text-xs text-[var(--text-muted)] mt-4 opacity-50">
              Usually takes about a minute
            </p>

            {/* Script preview */}
            {script && (
              <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
                <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium mb-3">
                  {script.title}
                </p>
                <div className="space-y-2.5 max-h-40 overflow-y-auto warm-scrollbar">
                  {script.segments.slice(0, 3).map((seg, i) => (
                    <div
                      key={i}
                      className="flex gap-3 text-sm animate-fade-in"
                    >
                      <span
                        className="font-semibold shrink-0"
                        style={{
                          color:
                            seg.speaker === "host_a"
                              ? "var(--amber)"
                              : "var(--teal)",
                        }}
                      >
                        {seg.speaker === "host_a"
                          ? script.hostA.name
                          : script.hostB.name}
                      </span>
                      <span className="text-[var(--text-secondary)] leading-relaxed">
                        {seg.text}
                      </span>
                    </div>
                  ))}
                  {script.segments.length > 3 && (
                    <p className="text-[var(--text-muted)] text-xs">
                      +{script.segments.length - 3} more...
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─────────── ERROR ─────────── */}
      {step === "error" && (
        <section className="relative z-10 max-w-2xl mx-auto px-5 sm:px-8 pb-10 w-full animate-fade-up">
          <div className="rounded-2xl p-6 text-center border border-red-900/30 bg-red-950/20">
            <p className="text-red-400/90 mb-4 text-sm">{error}</p>
            <button
              onClick={() => setStep("idle")}
              className="px-5 py-2.5 rounded-xl glass text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Try Again
            </button>
          </div>
        </section>
      )}

      {/* ─────────── PODCAST PLAYER ─────────── */}
      {step === "done" && script && dialogueAudio && (
        <section ref={playerRef} className="relative z-10 max-w-2xl mx-auto px-5 sm:px-8 pb-10 w-full animate-fade-up">
          <div className="glass-warm rounded-2xl overflow-hidden">
            {/* ── Player Header ── */}
            <div className="relative p-6 sm:p-8 overflow-hidden">
              <div className="relative flex flex-col sm:flex-row sm:items-start gap-5">
                {/* "Album art" — vinyl-inspired circle */}
                <div className="hidden sm:flex shrink-0 w-20 h-20 rounded-2xl items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  <div
                    className={`w-10 h-10 rounded-full border-2 border-[var(--text-primary)]/20 flex items-center justify-center ${isPlaying ? "animate-spin-slow" : ""}`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-primary)]/40" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl text-[var(--text-primary)] leading-tight mb-1.5">
                    {script.title}
                  </h2>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    <span style={{ color: "var(--amber)" }}>
                      {script.hostA.name}
                    </span>
                    {" & "}
                    <span style={{ color: "var(--teal)" }}>
                      {script.hostB.name}
                    </span>
                    <span className="mx-2 opacity-30">/</span>
                    {voiceSegments.length} segments
                  </p>
                </div>

                {/* Actions */}
                <div className="hidden sm:flex items-center gap-2">
                  {podcastId && (
                    <button
                      onClick={copyLink}
                      className="p-3 rounded-xl glass hover:border-amber-500/20 transition-all group"
                      title={copied ? "Copied!" : "Copy link"}
                    >
                      {copied ? (
                        <svg
                          className="w-5 h-5 text-amber-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-5 h-5 text-[var(--text-muted)] group-hover:text-amber-400 transition-colors"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                    onClick={downloadPodcast}
                    className="p-3 rounded-xl glass hover:border-amber-500/20 transition-all group"
                    title="Download"
                  >
                    <svg
                      className="w-5 h-5 text-[var(--text-muted)] group-hover:text-amber-400 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* ── Play Controls ── */}
              <div className="relative flex items-center gap-4 sm:gap-5 mt-6 sm:mt-8">
                <button
                  onClick={togglePlayback}
                  className="w-14 h-14 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all shadow-md shrink-0"
                  style={{
                    background: "#111111",
                    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
                  }}
                >
                  {isPlaying ? (
                    <svg
                      className="w-5 h-5 text-white"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 ml-0.5 text-white"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {/* Progress bar + segment indicators */}
                <div className="flex-1 min-w-0">
                  {/* Clickable progress bar */}
                  <div
                    className="w-full h-2 rounded-full bg-[var(--bg-elevated)] cursor-pointer relative overflow-hidden group/progress"
                    onClick={seekToTime}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-[width] duration-200"
                      style={{
                        width: duration
                          ? `${(playbackTime / duration) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>

                  {/* Segment indicators — proportional width */}
                  {voiceSegments.length > 0 && (
                    <div className="flex items-center gap-[2px] mt-1.5">
                      {voiceSegments.map((seg, i) => {
                        const segDuration = seg.endTime - seg.startTime;
                        const isActive = i === currentSegment;
                        const isPast = currentSegment >= 0 && i < currentSegment;
                        const isHostA = seg.speaker === "host_a";
                        return (
                          <button
                            key={i}
                            onClick={() => seekToSegment(i)}
                            className="rounded-full transition-all cursor-pointer"
                            style={{
                              flex: Math.max(segDuration, 0.5),
                              height: isActive ? "6px" : "3px",
                              background: isActive
                                ? isHostA
                                  ? "var(--amber)"
                                  : "var(--teal)"
                                : isPast
                                  ? isHostA
                                    ? "rgba(245, 158, 11, 0.3)"
                                    : "rgba(45, 212, 191, 0.3)"
                                  : "var(--border-subtle)",
                            }}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Time display */}
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] tabular-nums mt-1">
                    <span>{formatTime(playbackTime)}</span>
                    <span className="opacity-30">/</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Transcript ── */}
            <div className="px-5 sm:px-8 pb-6 sm:pb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-semibold">
                  Transcript
                </h3>
                {/* Mobile actions */}
                <div className="sm:hidden flex items-center gap-3">
                  {podcastId && (
                    <button
                      onClick={copyLink}
                      className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] hover:text-amber-400 transition-colors"
                    >
                      {copied ? (
                        <svg
                          className="w-3.5 h-3.5 text-amber-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                      )}
                      {copied ? "Copied" : "Share"}
                    </button>
                  )}
                  <button
                    onClick={downloadPodcast}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] hover:text-amber-400 transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto warm-scrollbar">
                {voiceSegments.map((seg, i) => {
                  const isActive = i === currentSegment;
                  const isHostA = seg.speaker === "host_a";
                  const accentColor = isHostA
                    ? "var(--amber)"
                    : "var(--teal)";
                  const glowColor = isHostA
                    ? "var(--amber-glow)"
                    : "var(--teal-glow)";

                  return (
                    <button
                      key={i}
                      data-segment={i}
                      onClick={() => seekToSegment(i)}
                      className="w-full text-left flex gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl transition-all"
                      style={{
                        background: isActive ? glowColor : "transparent",
                        borderLeft: isActive
                          ? `2px solid ${accentColor}`
                          : "2px solid transparent",
                      }}
                    >
                      {/* Avatar */}
                      <div
                        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 text-xs sm:text-sm font-bold transition-all"
                        style={{
                          background: isActive
                            ? accentColor
                            : `${accentColor}15`,
                          color: isActive ? "#FFFFFF" : accentColor,
                        }}
                      >
                        {seg.name[0]}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p
                            className="text-xs sm:text-sm font-semibold"
                            style={{ color: accentColor }}
                          >
                            {seg.name}
                          </p>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums opacity-60">
                            {formatTime(seg.startTime)}
                          </span>
                        </div>
                        <p
                          className="text-sm leading-relaxed transition-colors"
                          style={{
                            color: isActive
                              ? "var(--text-primary)"
                              : "var(--text-secondary)",
                          }}
                        >
                          {seg.text}
                        </p>
                      </div>

                      {/* Live waveform indicator */}
                      {isActive && isPlaying && (
                        <div className="flex items-center gap-[2px] shrink-0 self-center">
                          {[0, 1, 2, 3].map((j) => (
                            <div
                              key={j}
                              className="w-[2px] rounded-full waveform-bar"
                              style={{
                                animationDelay: `${j * 0.12}s`,
                                height: "18px",
                                background: accentColor,
                                opacity: 0.6,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Generate another */}
          <div className="text-center mt-8">
            <button
              onClick={() => {
                audioRef.current?.pause();
                setStep("idle");
                setTopic("");
                setCurrentSegment(-1);
                setIsPlaying(false);
                setPlaybackTime(0);
                setDuration(0);
                setPodcastId(null);
                window.history.replaceState(
                  null,
                  "",
                  window.location.pathname
                );
              }}
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl glass text-sm text-[var(--text-muted)] hover:text-amber-300 hover:border-amber-500/20 transition-all"
            >
              <svg
                className="w-4 h-4 transition-transform group-hover:-rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              New Episode
            </button>
          </div>
        </section>
      )}

      {/* ─────────── FOOTER ─────────── */}
      <footer className="relative z-10 mt-auto py-8 sm:py-10 text-center">
        <div className="flex items-center justify-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Built for</span>
          <span className="text-amber-600 font-semibold tracking-wide">
            #ElevenHacks
          </span>
          <span className="opacity-30">/</span>
          <a
            href="https://elevenlabs.io"
            className="hover:text-amber-600 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            ElevenLabs
          </a>
          <span className="opacity-30">+</span>
          <a
            href="https://replit.com"
            className="hover:text-teal-600 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Replit
          </a>
        </div>
      </footer>
    </main>
  );
}
