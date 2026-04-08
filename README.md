# VoiceCast

**Live demo:** https://voicecast.lever-labs.com

AI podcast generator that turns any topic into a full two-host podcast episode with custom-designed voices.

Type a topic, and VoiceCast will write a script, design unique voices for each host, generate the audio, and give you a playable episode with a synced transcript — all in about a minute.

Built for [ElevenHacks](https://hacks.elevenlabs.io) (Replit x ElevenLabs).

## How It Works

1. **Script** — Gemini writes a conversational podcast script with two distinct hosts
2. **Voice Design** — ElevenLabs Voice Design API creates unique voices from text descriptions (not presets)
3. **Recording** — Text-to-Dialogue API generates the full episode as a single multi-speaker audio track with per-segment timestamps
4. **Sound Effects** — Text-to-Sound-Effects API creates a podcast intro jingle
5. **Playback** — Real-time transcript sync, click-to-seek, progress bar, single MP3 download

## ElevenLabs APIs Used

- **Voice Design** (`textToVoice`) — AI-generated voices from descriptions
- **Text-to-Dialogue** (`textToDialogue.convertWithTimestamps`) — Native multi-speaker audio with timestamps
- **Sound Effects** (`textToSoundEffects`) — Generated intro jingles

## Setup

```bash
npm install
cp .env.local.example .env.local
# Add your API keys to .env.local
npm run dev
```

Requires:
- `ELEVENLABS_API_KEY` — from [elevenlabs.io](https://elevenlabs.io)
- `GOOGLE_API_KEY` — free from [aistudio.google.com](https://aistudio.google.com/apikey)

## Stack

Next.js, React, TypeScript, Tailwind CSS, ElevenLabs SDK, Google Gemini
