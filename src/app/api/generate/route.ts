import { GoogleGenerativeAI } from "@google/generative-ai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { type PodcastScript } from "@/lib/types";

export const maxDuration = 120;

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "VoiceCast/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    // Strip HTML tags, scripts, styles → plain text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Limit to ~4000 chars to fit in prompt context
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

async function generateScript(
  topic: string,
  tone: string = "casual",
  length: string = "medium",
  sourceContent?: string,
  cloneName?: string,
  language: string = "en"
): Promise<PodcastScript> {
  const segmentCounts: Record<string, string> = {
    short: "4-5",
    medium: "6-8",
    long: "10-14",
  };
  const toneGuides: Record<string, string> = {
    casual: "Keep it relaxed and conversational, like two friends chatting over coffee.",
    educational: "Be informative and insightful. Teach the listener something new with clear explanations.",
    debate: "Hosts should have opposing views and challenge each other respectfully. Create tension and counterarguments.",
    comedy: "Make it hilarious. Use wit, wordplay, absurd analogies, and comedic timing.",
  };
  const exchanges = segmentCounts[length] || "6-8";
  const toneGuide = toneGuides[tone] || toneGuides.casual;
  const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are a podcast script writer. Create a short, engaging podcast script about: "${topic}"${sourceContent ? `\n\nBase the discussion on this source material:\n"""\n${sourceContent}\n"""` : ""}

The podcast has two hosts:
- Host A: The main presenter who introduces topics and drives the conversation${cloneName ? `. Host A's name MUST be "${cloneName}" — this is the user's real name (their voice is cloned), so do NOT generate a voiceDescription for hostA.` : ""}
- Host B: The co-host who adds insights, asks questions, and provides counterpoints

Tone: ${toneGuide}
${language !== "en" ? `\nIMPORTANT: Write ALL dialogue text in the language with ISO code "${language}". Host names can remain English-sounding, but all spoken text in segments MUST be in ${language}.` : ""}

Rules:
- Write ${exchanges} exchanges total (each exchange is one person speaking)
- Each exchange should be 1-3 sentences, conversational and natural
- Start with Host A introducing the topic
- End with a natural wrap-up
- Give each host a distinct personality

Also create unique voice descriptions for each host that would work with a voice design AI. Be creative and specific about tone, pace, age, and style.

Respond in this exact JSON format:
{
  "title": "Episode title here",
  "hostA": {
    "name": "A first name",
    "voiceDescription": "Detailed voice description for AI voice design, 20-100 chars. Example: A warm friendly male narrator in his 30s with a smooth confident delivery"
  },
  "hostB": {
    "name": "A first name",
    "voiceDescription": "Detailed voice description for AI voice design, 20-100 chars. Example: An energetic young woman with a bright curious tone and quick pace"
  },
  "segments": [
    { "speaker": "host_a", "text": "What the host says" },
    { "speaker": "host_b", "text": "What the co-host says" }
  ]
}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const text = result.response.text();
  return JSON.parse(text) as PodcastScript;
}

async function designVoice(
  elevenlabs: ElevenLabsClient,
  description: string,
  sampleText: string
): Promise<string> {
  const response = await elevenlabs.textToVoice.createPreviews({
    voiceDescription: description,
    text: sampleText.slice(0, 1000),
  });

  const preview = response.previews?.[0];
  if (!preview?.generatedVoiceId) {
    throw new Error("Voice design failed — no preview returned");
  }

  const voice = await elevenlabs.textToVoice.create({
    voiceName: `VoiceCast-${Date.now()}`,
    voiceDescription: description,
    generatedVoiceId: preview.generatedVoiceId,
  });

  return voice.voiceId ?? preview.generatedVoiceId;
}

async function generateIntroSfx(
  elevenlabs: ElevenLabsClient
): Promise<string | undefined> {
  try {
    const sfxStream = await elevenlabs.textToSoundEffects.convert({
      text: "podcast intro jingle, warm upbeat modern short cinematic whoosh",
      durationSeconds: 3,
      promptInfluence: 0.4,
    });
    const chunks: Uint8Array[] = [];
    const reader = (sfxStream as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks).toString("base64");
  } catch {
    return undefined;
  }
}

async function collectStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks).toString("base64");
}

export async function POST(request: Request) {
  const elevenlabs = new ElevenLabsClient();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const { topic, tone, length, sourceUrl, cloneVoiceId, cloneName, language } =
          (await request.json()) as {
            topic: string;
            tone?: string;
            length?: string;
            sourceUrl?: string;
            cloneVoiceId?: string;
            cloneName?: string;
            language?: string;
          };
        if (!topic?.trim()) {
          send({ step: "error", error: "Topic is required" });
          controller.close();
          return;
        }

        // Step 0: Fetch source URL content if provided
        let sourceContent: string | undefined;
        if (sourceUrl) {
          send({ step: "script", message: "Reading source article..." });
          sourceContent = await fetchUrlContent(sourceUrl);
        }

        // Step 1: Generate script with Gemini
        send({ step: "script", message: "Writing your podcast script..." });
        const script = await generateScript(topic, tone, length, sourceContent, cloneVoiceId ? cloneName : undefined, language);
        send({ step: "script_done", script });

        // Step 2: Design voices (use clone for Host A if provided)
        send({
          step: "voices",
          message: cloneVoiceId
            ? `Using your cloned voice for ${script.hostA.name}. Designing ${script.hostB.name}'s voice...`
            : `Designing voices for ${script.hostA.name} & ${script.hostB.name}...`,
        });

        const hostBText = script.segments
          .filter((s) => s.speaker === "host_b")
          .map((s) => s.text)
          .join(" ")
          .slice(0, 500);

        let voiceIdA: string;
        let voiceIdB: string;

        if (cloneVoiceId) {
          // Host A = cloned voice, only design Host B
          voiceIdA = cloneVoiceId;
          voiceIdB = await designVoice(
            elevenlabs,
            script.hostB.voiceDescription,
            hostBText || "Thanks for having me, great to be here."
          );
        } else {
          // Design both voices
          const hostAText = script.segments
            .filter((s) => s.speaker === "host_a")
            .map((s) => s.text)
            .join(" ")
            .slice(0, 500);

          [voiceIdA, voiceIdB] = await Promise.all([
            designVoice(
              elevenlabs,
              script.hostA.voiceDescription,
              hostAText || "Hello, welcome to our podcast today."
            ),
            designVoice(
              elevenlabs,
              script.hostB.voiceDescription,
              hostBText || "Thanks for having me, great to be here."
            ),
          ]);
        }

        send({
          step: "voices_done",
          voiceA: cloneVoiceId ? (cloneName || "You") : script.hostA.name,
          voiceB: script.hostB.name,
        });

        // Step 3: Generate intro SFX + podcast dialogue (in parallel)
        // Uses Text-to-Sound-Effects API for jingle
        // Uses Text-to-Dialogue API for native multi-speaker audio with timestamps
        send({
          step: "audio",
          message: "Recording podcast & creating sound effects...",
        });

        const dialogueInputs = script.segments.map((seg) => ({
          text: seg.text,
          voiceId: seg.speaker === "host_a" ? voiceIdA : voiceIdB,
        }));

        // Run SFX generation in parallel with dialogue
        const sfxPromise = generateIntroSfx(elevenlabs);

        // Try textToDialogue with timestamps first (native multi-speaker)
        // Falls back to per-segment TTS if unavailable
        let dialogueAudioBase64: string;
        let voiceSegments: {
          speaker: string;
          name: string;
          text: string;
          startTime: number;
          endTime: number;
        }[];

        try {
          const dialogueResult =
            await elevenlabs.textToDialogue.convertWithTimestamps({
              inputs: dialogueInputs,
              ...(language && language !== "en" ? { languageCode: language } : {}),
            });

          dialogueAudioBase64 = dialogueResult.audioBase64;
          voiceSegments = (dialogueResult.voiceSegments ?? []).map((vs) => {
            const seg = script.segments[vs.dialogueInputIndex];
            return {
              speaker: seg?.speaker || "host_a",
              name:
                seg?.speaker === "host_a"
                  ? script.hostA.name
                  : script.hostB.name,
              text: seg?.text || "",
              startTime: vs.startTimeSeconds,
              endTime: vs.endTimeSeconds,
            };
          });
        } catch {
          // Fallback: per-segment TTS if textToDialogue is unavailable
          const segmentAudios: string[] = [];
          for (let i = 0; i < script.segments.length; i += 2) {
            const batch = script.segments.slice(i, i + 2);
            const results = await Promise.all(
              batch.map(async (segment) => {
                const voiceId =
                  segment.speaker === "host_a" ? voiceIdA : voiceIdB;
                const audioStream = await elevenlabs.textToSpeech.convert(
                  voiceId,
                  {
                    text: segment.text,
                    modelId: "eleven_multilingual_v2",
                    outputFormat: "mp3_44100_128",
                  }
                );
                return collectStream(
                  audioStream as ReadableStream<Uint8Array>
                );
              })
            );
            segmentAudios.push(...results);
          }

          // Concatenate all segments into one audio
          const allChunks = segmentAudios.map((b64) => {
            const binary = Buffer.from(b64, "base64");
            return new Uint8Array(binary);
          });
          const totalLength = allChunks.reduce((s, c) => s + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of allChunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          dialogueAudioBase64 = Buffer.from(merged).toString("base64");

          // Estimate segment timings (rough: ~150 words per minute)
          let runningTime = 0;
          voiceSegments = script.segments.map((seg) => {
            const words = seg.text.split(/\s+/).length;
            const duration = (words / 150) * 60;
            const timing = {
              speaker: seg.speaker,
              name:
                seg.speaker === "host_a"
                  ? script.hostA.name
                  : script.hostB.name,
              text: seg.text,
              startTime: runningTime,
              endTime: runningTime + duration,
            };
            runningTime += duration;
            return timing;
          });
        }

        // Await SFX (was started in parallel with dialogue)
        const introBase64 = await sfxPromise;

        // Done — send everything
        send({
          step: "done",
          script,
          introAudioBase64: introBase64 || null,
          dialogueAudioBase64,
          voiceSegments,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "An error occurred";
        send({ step: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
