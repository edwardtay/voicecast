"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type PodcastScript,
  type VoiceSegmentTiming,
  type GenerationStep,
} from "@/lib/types";
import {
  Mic,
  Upload,
  Play,
  Pause,
  Download,
  Link2,
  Check,
  RotateCcw,
  Loader2,
  Globe,
  X,
  CircleStop,
  Sparkles,
} from "lucide-react";

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
  const [language, setLanguage] = useState("en");
  const [cloneVoiceId, setCloneVoiceId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneStatus, setCloneStatus] = useState<"idle" | "recording" | "uploading" | "done">("idle");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [clonePreviewUrl, setClonePreviewUrl] = useState<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
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
      // Request high-quality audio
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      // Prefer opus — it's ~5–10x smaller than PCM-in-WebM (88 KB/s vs 16 KB/s),
      // which matters because 30s of PCM blows past most proxy body-size caps
      // (CapRover nginx defaults to 1 MB). Opus at 128 kbps is already
      // near-transparent for speech, and ElevenLabs IVC handles it fine.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/webm;codecs=pcm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128_000,
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setClonePreviewUrl(URL.createObjectURL(blob));
        await uploadVoiceClone(blob);
      };

      recorder.start(1000); // Collect data every second for responsive stop
      setIsRecording(true);
      setCloneStatus("recording");
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch {
      setCloneStatus("idle");
      setError("Microphone access denied. Please allow microphone permission.");
      setStep("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      if (recordingTime < 5) {
        // Too short — keep recording
        return;
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [recordingTime]);

  const uploadVoiceClone = useCallback(async (audioBlob: Blob) => {
    setCloneStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice-sample.webm");

      const res = await fetch("/api/clone-voice", {
        method: "POST",
        body: formData,
      });

      // Read as text first so non-JSON error bodies (e.g. proxy "Request Entity
      // Too Large") surface a real message instead of "Unexpected token R".
      const text = await res.text();
      let data: { voiceId?: string; previewBase64?: string; error?: string } = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server error (${res.status}): ${text.slice(0, 200) || "empty response"}`
        );
      }
      if (!res.ok) throw new Error(data.error || `Clone failed (${res.status})`);
      if (data.voiceId) {
        setCloneVoiceId(data.voiceId);
        setCloneStatus("done");
        // Use the AI-generated preview (cloned voice speaking) instead of raw recording
        if (data.previewBase64) {
          if (clonePreviewUrl) URL.revokeObjectURL(clonePreviewUrl);
          setClonePreviewUrl(`data:audio/mpeg;base64,${data.previewBase64}`);
        }
      } else {
        throw new Error("Clone failed — no voice ID returned");
      }
    } catch (err) {
      setCloneStatus("idle");
      setCloneVoiceId(null);
      setError(err instanceof Error ? err.message : "Voice cloning failed");
      setStep("error");
    }
  }, [clonePreviewUrl]);

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
          mode: "script",
          topic: finalTopic,
          tone,
          length,
          sourceUrl: sourceUrl.trim() || undefined,
          cloneVoiceId: cloneVoiceId || undefined,
          cloneName: cloneName.trim() || undefined,
          language,
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
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          switch (data.step) {
            case "script":
              setStep("script");
              setStatusMessage(data.message);
              break;
            case "script_done":
              setScript(data.script);
              setStep("review");
              setStatusMessage("");
              break;
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
  }, [topic, tone, length, sourceUrl, cloneVoiceId, cloneName, language]);

  const generateAudio = useCallback(async () => {
    if (!script) return;

    setStep("voices");
    setStatusMessage("Designing voices...");
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "audio",
          script,
          cloneVoiceId: cloneVoiceId || undefined,
          cloneName: cloneName.trim() || undefined,
          language,
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
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          switch (data.step) {
            case "voices":
              setStep("voices");
              setStatusMessage(data.message);
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
      setError(err instanceof Error ? err.message : "Audio generation failed");
    }
  }, [script, cloneVoiceId, cloneName, language]);

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

  const isGenerating = step !== "idle" && step !== "review" && step !== "done" && step !== "error";

  return (
    <main className="min-h-screen flex flex-col relative overflow-hidden font-[family-name:var(--font-body)]">
      {/* ─────────── HERO ─────────── */}
      <section className="relative z-10">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-6 sm:pb-10">
          {/* Header — aligned with card padding */}
          <div className="animate-fade-up stagger-1 flex items-baseline justify-between mb-8 sm:mb-10 px-5 sm:px-6">
            <h1 className="font-[family-name:var(--font-display)] text-4xl sm:text-5xl leading-[1] text-[var(--text-primary)]">
              VoiceCast
            </h1>
            <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] hidden sm:block">
              AI Podcast Studio
            </span>
          </div>

          {/* ── Console Card ── */}
          <div className="animate-fade-up stagger-2 glass-warm rounded-2xl overflow-hidden mb-8">
            {/* Input section */}
            <div className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isGenerating) generate();
                  }}
                  placeholder="Topic — what's the podcast about?"
                  disabled={isGenerating}
                  className="console-input flex-1"
                />
                <button
                  onClick={() => generate()}
                  disabled={isGenerating || !topic.trim()}
                  className="group px-6 py-3 rounded-[var(--radius)] font-medium text-[13px] transition-all disabled:opacity-25 disabled:cursor-not-allowed shrink-0"
                  style={{
                    background: isGenerating ? "var(--bg-elevated)" : "var(--amber)",
                    color: isGenerating ? "var(--text-muted)" : "#0C0C0E",
                  }}
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate
                    </span>
                  )}
                </button>
              </div>
              <div className="relative mt-2.5">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="Or paste an article URL"
                  disabled={isGenerating}
                  className="console-input !pl-9 !pr-9 !py-2.5 !text-[12px]"
                />
                {sourceUrl && (
                  <button onClick={() => setSourceUrl("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Controls — only on idle */}
            {step === "idle" && (
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-input)]">
                {/* Host Voice — PRIMARY control */}
                <div className="p-5 sm:p-6 border-b border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-medium mb-3 block">Host Voice</span>
                  {cloneStatus === "done" && cloneVoiceId ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-surface)] border border-green-500/30">
                        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        <span className="text-[12px] text-green-700 font-medium shrink-0">Your voice</span>
                        <input
                          type="text"
                          value={cloneName}
                          onChange={(e) => setCloneName(e.target.value)}
                          placeholder="Enter your name"
                          className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] text-[12px] focus:outline-none border-b border-[var(--border-subtle)] pb-0.5"
                        />
                        <button onClick={() => { setCloneVoiceId(null); setCloneStatus("idle"); setCloneName(""); setClonePreviewUrl(""); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {clonePreviewUrl && (
                        <div>
                          <p className="text-[10px] text-[var(--text-muted)] mb-1.5">Hear your cloned voice:</p>
                          <audio src={clonePreviewUrl} controls className="w-full h-8 rounded-md" />
                        </div>
                      )}
                      <p className="text-[10px] text-green-600">
                        {clonePreviewUrl
                          ? "Sound right? You\u2019ll host this episode. Co-host gets an AI voice."
                          : "Cloned \u2014 you\u2019ll host this episode."}
                      </p>
                    </div>
                  ) : cloneStatus === "uploading" ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--amber)]" />
                        <span className="text-[12px] text-[var(--text-secondary)]">Cloning voice & generating preview...</span>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)]">This takes a few seconds — we{"'"}re creating your AI voice clone and a test sample</p>
                    </div>
                  ) : cloneStatus === "recording" ? (
                    <div className="space-y-2.5">
                      <button
                        onClick={stopRecording}
                        disabled={recordingTime < 5}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg text-[12px] font-medium transition-all disabled:cursor-not-allowed"
                        style={{
                          background: recordingTime < 5 ? "var(--bg-elevated)" : "rgba(220,38,38,0.08)",
                          border: recordingTime < 5 ? "1px solid var(--border-subtle)" : "1px solid rgba(220,38,38,0.25)",
                          color: recordingTime < 5 ? "var(--text-secondary)" : "#dc2626",
                        }}
                      >
                        <CircleStop className="w-4 h-4 animate-pulse" />
                        {recordingTime < 5
                          ? `Recording... ${recordingTime}s (min 5s)`
                          : `Stop — ${recordingTime}s recorded`}
                      </button>
                      <div className="flex items-center gap-[2px] justify-center">
                        {[0,1,2,3,4,5,6,7].map((j) => (
                          <div key={j} className="w-[3px] rounded-full waveform-bar" style={{
                            height: "14px",
                            background: recordingTime < 5 ? "var(--text-muted)" : "#dc2626",
                            opacity: 0.4,
                            animationDelay: `${j * 0.08}s`,
                          }} />
                        ))}
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] text-center">
                        {recordingTime < 10
                          ? "Speak naturally — read anything out loud"
                          : "Good quality! Stop anytime or continue up to 30s"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className="pill pill-active flex flex-col items-center gap-1.5 !py-3"
                        onClick={() => {}}
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>AI Voice</span>
                        <span className="text-[9px] opacity-60">Default</span>
                      </button>
                      <button
                        onClick={startRecording}
                        className="pill flex flex-col items-center gap-1.5 !py-3"
                      >
                        <Mic className="w-4 h-4" />
                        <span>Record</span>
                        <span className="text-[9px] opacity-60">Use your voice</span>
                      </button>
                      <label className="pill flex flex-col items-center gap-1.5 !py-3 cursor-pointer">
                        <Upload className="w-4 h-4" />
                        <span>Upload</span>
                        <span className="text-[9px] opacity-60">From file</span>
                        <input type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
                      </label>
                    </div>
                  )}
                </div>

                {/* Secondary controls */}
                <div className="p-5 sm:p-6 grid grid-cols-3 gap-5">
                  {/* Tone */}
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-medium mb-2.5 block">Tone</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(["casual", "educational", "debate", "comedy"] as const).map((t) => (
                        <button key={t} onClick={() => setTone(t)} className={`pill ${tone === t ? "pill-active" : ""}`}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Length */}
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-medium mb-2.5 block">Length</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(["short", "medium", "long"] as const).map((l) => (
                        <button key={l} onClick={() => setLength(l)} className={`pill ${length === l ? "pill-active" : ""}`}>
                          {l.charAt(0).toUpperCase() + l.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Language */}
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-medium mb-2.5 block">Language</span>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-active)] cursor-pointer"
                    >
                      {[
                        { code: "en", name: "English" },
                        { code: "ja", name: "Japanese" },
                        { code: "zh", name: "Chinese" },
                        { code: "ko", name: "Korean" },
                        { code: "es", name: "Spanish" },
                        { code: "fr", name: "French" },
                        { code: "de", name: "German" },
                        { code: "pt", name: "Portuguese" },
                        { code: "it", name: "Italian" },
                        { code: "hi", name: "Hindi" },
                        { code: "ar", name: "Arabic" },
                        { code: "tr", name: "Turkish" },
                        { code: "pl", name: "Polish" },
                        { code: "nl", name: "Dutch" },
                        { code: "sv", name: "Swedish" },
                      ].map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Quick topics */}
                <div className="px-5 sm:px-6 pb-4 sm:pb-5 border-t border-[var(--border-subtle)]">
                  <div className="flex sm:flex-wrap gap-1.5 overflow-x-auto no-scrollbar pt-4">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-medium shrink-0 self-center mr-1">Try</span>
                    {SUGGESTED_TOPICS.map((t) => (
                      <button key={t} onClick={() => generate(t)} className="pill shrink-0 !py-1 !text-[10px]">
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

      {/* ─────────── SCRIPT REVIEW / EDIT ─────────── */}
      {step === "review" && script && (
        <section className="relative z-10 max-w-2xl mx-auto px-5 sm:px-8 pb-10 w-full animate-fade-up">
          <div className="glass-warm rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 sm:p-6 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <input
                  type="text"
                  value={script.title}
                  onChange={(e) => setScript({ ...script, title: e.target.value })}
                  className="font-[family-name:var(--font-display)] text-xl sm:text-2xl text-[var(--text-primary)] bg-transparent focus:outline-none w-full"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  {script.segments.length} segments — edit any line below, then record
                </p>
              </div>
            </div>

            {/* Editable segments */}
            <div className="p-5 sm:p-6 space-y-3 max-h-[50vh] overflow-y-auto warm-scrollbar">
              {script.segments.map((seg, i) => {
                const isHostA = seg.speaker === "host_a";
                const name = isHostA ? script.hostA.name : script.hostB.name;
                const color = isHostA ? "var(--amber)" : "var(--teal)";
                return (
                  <div key={i} className="flex gap-3 group">
                    <button
                      onClick={() => {
                        const updated = { ...script };
                        updated.segments = updated.segments.map((s, j) =>
                          j === i ? { ...s, speaker: s.speaker === "host_a" ? "host_b" as const : "host_a" as const } : s
                        );
                        setScript(updated);
                      }}
                      className="w-16 shrink-0 text-[12px] font-semibold text-right pt-2.5 hover:opacity-70 transition-opacity cursor-pointer"
                      style={{ color }}
                      title="Click to swap speaker"
                    >
                      {name}
                    </button>
                    <textarea
                      value={seg.text}
                      onChange={(e) => {
                        const updated = { ...script };
                        updated.segments = updated.segments.map((s, j) =>
                          j === i ? { ...s, text: e.target.value } : s
                        );
                        setScript(updated);
                      }}
                      rows={2}
                      className="flex-1 console-input !py-2 !text-[13px] leading-relaxed resize-none"
                    />
                    <button
                      onClick={() => {
                        const updated = { ...script };
                        updated.segments = updated.segments.filter((_, j) => j !== i);
                        setScript(updated);
                      }}
                      className="shrink-0 self-start pt-2.5 text-[var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="p-5 sm:p-6 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <button
                onClick={() => { setStep("idle"); setScript(null); }}
                className="pill text-[12px]"
              >
                Start over
              </button>
              <button
                onClick={generateAudio}
                className="px-6 py-3 rounded-[var(--radius)] font-medium text-[13px] transition-all flex items-center gap-2"
                style={{ background: "var(--text-primary)", color: "var(--bg-deep)" }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Record Audio
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ─────────── ERROR ─────────── */}
      {step === "error" && (
        <section className="relative z-10 max-w-2xl mx-auto px-5 sm:px-8 pb-10 w-full animate-fade-up">
          <div className="rounded-2xl p-6 text-center border border-red-200 bg-red-50">
            <p className="text-red-600 mb-4 text-sm">{error}</p>
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
                <div className="hidden sm:flex shrink-0 w-16 h-16 rounded-xl items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  <div
                    className={`w-8 h-8 rounded-full border-2 border-[var(--amber)]/30 flex items-center justify-center ${isPlaying ? "animate-spin-slow" : ""}`}
                  >
                    <div className="w-2 h-2 rounded-full bg-[var(--amber)]/50" />
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
                      className="p-2.5 rounded-lg glass hover:border-[var(--border-warm)] transition-all group"
                      title={copied ? "Copied!" : "Copy link"}
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Link2 className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={downloadPodcast}
                    className="p-2.5 rounded-lg glass hover:border-[var(--border-warm)] transition-all group"
                    title="Download"
                  >
                    <Download className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                  </button>
                </div>
              </div>

              {/* ── Play Controls ── */}
              <div className="relative flex items-center gap-4 sm:gap-5 mt-6 sm:mt-8">
                <button
                  onClick={togglePlayback}
                  className="w-12 h-12 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all shrink-0"
                  style={{
                    background: "#111111",
                    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
                  }}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 text-white" fill="white" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5 text-white" fill="white" />
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
                      className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-amber-500" /> : <Link2 className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Share"}
                    </button>
                  )}
                  <button
                    onClick={downloadPodcast}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
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
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl glass text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-warm)] transition-all"
            >
              <RotateCcw className="w-4 h-4 transition-transform group-hover:-rotate-90" />
              New Episode
            </button>
          </div>
        </section>
      )}

      {/* ─────────── FOOTER ─────────── */}
      <footer className="relative z-10 mt-auto py-8 sm:py-10 text-center space-y-2">
        <p className="text-[11px] text-[var(--text-muted)]">
          Powered by{" "}
          <a href="https://elevenlabs.io" className="hover:text-[var(--text-secondary)] transition-colors" target="_blank" rel="noopener noreferrer">ElevenLabs</a>
          {" "}Voice Design, Voice Cloning, Text-to-Dialogue & Sound Effects APIs
        </p>
        <p className="text-[10px] text-[var(--text-muted)] opacity-60">
          AI-generated content. Voices are synthetically designed or cloned with user consent.
        </p>
      </footer>
    </main>
  );
}
