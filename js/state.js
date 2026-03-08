import { loadSettings } from "./storage.js";

export const appState = {
  settings: loadSettings(),
  records: [],
  filter: "all",
  query: "",
  libraryQuery: "",
  activeId: null,
  mediaRecorder: null,
  chunks: [],
  isRecording: false,
  audioUrl: null,
  deferredPrompt: null,
  ttsPlayback: {
    queue: [],
    currentAudio: null,
    activeRequestId: null,
    streamDone: false,
    drainResolvers: [],
    cancelledRequestIds: new Set(),
  },
  activeTasks: {
    stt: false,
    llm: false,
    tts: false,
  },
  currentView: "landing",
};
