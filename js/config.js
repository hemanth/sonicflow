export const STORAGE_KEY = "sonicflow-on-device-settings-v1";
export const DB_NAME = "sonicflow-notes";
export const DB_VERSION = 1;
export const STORE_NAME = "records";

export const DEFAULT_SETTINGS = {
  whisperModel: "Xenova/whisper-tiny.en",
  whisperLanguage: "en",
  qwenModel: "onnx-community/Qwen2.5-0.5B-Instruct",
  qwenDtype: "q4",
  kokoroModel: "onnx-community/Kokoro-82M-v1.0-ONNX",
  kokoroDtype: "q8",
  kokoroVoice: "af_bella",
};

export const ROUTES = {
  landing: "/",
  meetings: "/meetings",
  notes: "/notes",
  recordings: "/recordings",
};

export const FLOW_CONFIG = {
  meeting: {
    label: "Meeting",
    fallbackTitle: "Untitled meeting",
    generateLabel: "Create meeting notes",
    composeHeading: "Structured notes and playback",
    manualNotesLabel: "Context and manual notes",
    manualNotesPlaceholder: "Agenda, participants, follow-up items, or raw note fragments.",
    transcriptPlaceholder:
      "Transcript appears here after transcription. You can edit it before generating final notes.",
    notesPlaceholder: "Generated notes, action items, decisions, risks, and next steps.",
  },
  "voice-note": {
    label: "Voice note",
    fallbackTitle: "Untitled voice note",
    generateLabel: "Create voice note summary",
    composeHeading: "Summary and playback",
    manualNotesLabel: "Context or prompt",
    manualNotesPlaceholder:
      "What is this note about? Add a quick sentence, tags, or a rough outline.",
    transcriptPlaceholder:
      "Live or recorded transcript appears here. Edit it before you create the final summary.",
    notesPlaceholder: "Clean summary, key points, and follow-up items for this voice note.",
  },
};

export function getFlowConfig(type) {
  return FLOW_CONFIG[type] ?? FLOW_CONFIG.meeting;
}

export function getFallbackTitle(type) {
  return getFlowConfig(type).fallbackTitle;
}
