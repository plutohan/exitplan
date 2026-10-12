# Video production files

- `pitch.srt`, `demo.srt`: narration split into caption cues, timed at about 160 words per minute inside each script section. Use them (1) as the text for voice generation, one cue or paragraph at a time, and (2) as the caption track. Replace the placeholders (`$__M`, run counts) with the values of the recording day before generating audio.
- The proof take (0:15–1:20 of the demo) has no narration cues here: narrate it live over the screen, or record it silent and dub the sentences from `demo-video-script.md`.
- Pipeline: set up the hedge → record the proof take within 3 minutes of a reload → record the remaining segments → generate the voice (a clone of your own voice, or a plain TTS voice) → assemble in Descript or CapCut with the screen following the voice → auto-captions → export 1080p → unlisted link, tested in a private window → fill `docs/recording-evidence.md`.
