export interface PodcastSegment {
  speaker: "host_a" | "host_b";
  text: string;
}

export interface PodcastScript {
  title: string;
  hostA: { name: string; voiceDescription: string };
  hostB: { name: string; voiceDescription: string };
  segments: PodcastSegment[];
}

export interface VoiceSegmentTiming {
  speaker: string;
  name: string;
  text: string;
  startTime: number;
  endTime: number;
}

export type GenerationStep =
  | "idle"
  | "script"
  | "review"
  | "voices"
  | "audio"
  | "done"
  | "error";
