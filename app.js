import {
  DEFAULT_SETTINGS,
  ROUTES,
  getFlowConfig,
  getFallbackTitle,
  STORAGE_KEY,
} from "./js/config.js";
import { appState } from "./js/state.js";
import { ui } from "./js/dom.js";
import { createAIClient } from "./js/ai-client.js";
import {
  createRecordListMarkup,
  formatItemCount,
  getVisibleRecords,
} from "./js/records.js";
import {
  getAllRecords,
  saveRecord,
  removeRecord,
} from "./js/storage.js";
import {
  countWords,
  formatDate,
  pickSupportedMimeType,
  normalizePath,
  requestPersistentStorage,
} from "./js/utils.js";
import { decodeAudioBlob } from "./js/audio.js";
import { renderMarkdown } from "./js/markdown.js";
import {
  buildNotesMessages,
  buildRepairMessages,
  buildRewriteMessages,
  buildTitleMessages,
  REWRITE_PRESETS,
  sanitizeGeneratedNotes,
  sanitizeGeneratedTitle,
  needsNotesRepair,
} from "./js/notes.js";

const aiClient = createAIClient({
  getSettings: () => appState.settings,
  onStatus: applyStatus,
  onError: (event) => {
    console.error(event);
    showToast("The on-device AI worker failed to load");
  },
});

init().catch((error) => {
  console.error(error);
  showToast(error.message || "Failed to start app");
});

async function init() {
  bindEvents();
  await registerServiceWorker();
  await requestPersistentStorage();
  appState.records = await getAllRecords();
  appState.activeId = appState.records[0]?.id ?? null;
  renderSettings();
  updateCapabilityLabels();
  setRecordingUiState(false);
  setMarkdownTab("voice", "preview");
  setMarkdownTab("notes", "preview");
  handleRouteChange({ replace: true });
  aiClient.scheduleWarmup();
}

function bindEvents() {
  ui.startMeetingCard.addEventListener("click", createAndShowMeetingRecorder);
  ui.startVoiceNoteCard.addEventListener("click", createAndShowVoiceNote);
  ui.openLibraryButton.addEventListener("click", showLibrary);
  ui.recorderBackButton.addEventListener("click", showLanding);
  ui.recorderLibraryButton.addEventListener("click", showLibrary);
  ui.recorderModelsButton.addEventListener("click", () => ui.settingsDialog.showModal());
  ui.recorderTitleInput.addEventListener("input", syncRecorderTitle);
  ui.recorderStartButton.addEventListener("click", startRecording);
  ui.recorderStopButton.addEventListener("click", stopRecording);
  ui.recorderContinueButton.addEventListener("click", continueToWorkspace);
  ui.voiceBackButton.addEventListener("click", showLanding);
  ui.voiceLibraryButton.addEventListener("click", showLibrary);
  ui.voiceModelsButton.addEventListener("click", () => ui.settingsDialog.showModal());
  ui.voiceTitleInput.addEventListener("input", updateVoiceDraftFromInputs);
  ui.voiceTranscriptInput.addEventListener("input", updateVoiceDraftFromInputs);
  ui.voiceSummaryInput.addEventListener("input", updateVoiceDraftFromInputs);
  ui.voicePreviewTab.addEventListener("click", () => setMarkdownTab("voice", "preview"));
  ui.voiceRawTab.addEventListener("click", () => setMarkdownTab("voice", "raw"));
  ui.voiceCopyButton.addEventListener("click", copyVoiceSummary);
  ui.voiceStartButton.addEventListener("click", startRecording);
  ui.voiceStopButton.addEventListener("click", stopRecording);
  ui.voiceTranscribeButton.addEventListener("click", transcribeActiveRecord);
  ui.voiceGenerateButton.addEventListener("click", generateMeetingNotes);
  ui.voiceRewriteButton.addEventListener("click", rewriteActiveNotes);
  ui.voiceSpeakButton.addEventListener("click", toggleTtsPlayback);
  ui.voiceSaveButton.addEventListener("click", persistActiveRecord);
  ui.voiceDeleteButton.addEventListener("click", deleteActiveRecord);
  ui.homeButton.addEventListener("click", showLanding);
  ui.workspaceLibraryButton.addEventListener("click", showLibrary);
  ui.newMeetingButton.addEventListener("click", createAndShowMeetingRecorder);
  ui.newVoiceNoteButton.addEventListener("click", createAndShowVoiceNote);
  ui.libraryHomeButton.addEventListener("click", showLanding);
  ui.libraryModelsButton.addEventListener("click", () => ui.settingsDialog.showModal());
  ui.libraryMeetingButton.addEventListener("click", createAndShowMeetingRecorder);
  ui.libraryVoiceButton.addEventListener("click", createAndShowVoiceNote);
  ui.searchInput.addEventListener("input", (event) => {
    appState.query = event.target.value.trim().toLowerCase();
    renderList();
  });
  ui.librarySearchInput.addEventListener("input", (event) => {
    appState.libraryQuery = event.target.value.trim().toLowerCase();
    renderLibraryList();
  });

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      appState.filter = button.dataset.filter;
      document
        .querySelectorAll(".filter-chip")
        .forEach((chip) => chip.classList.toggle("active", chip === button));
      renderList();
    });
  });

  ui.titleInput.addEventListener("input", updateDraftFromInputs);
  ui.typeSelect.addEventListener("change", updateDraftFromInputs);
  ui.manualNotesInput.addEventListener("input", updateDraftFromInputs);
  ui.transcriptInput.addEventListener("input", updateDraftFromInputs);
  ui.meetingNotesInput.addEventListener("input", updateDraftFromInputs);
  ui.notesPreviewTab.addEventListener("click", () => setMarkdownTab("notes", "preview"));
  ui.notesRawTab.addEventListener("click", () => setMarkdownTab("notes", "raw"));
  ui.notesCopyButton.addEventListener("click", copyMeetingNotes);

  ui.transcribeButton.addEventListener("click", transcribeActiveRecord);
  ui.generateButton.addEventListener("click", generateMeetingNotes);
  ui.notesRewriteButton.addEventListener("click", rewriteActiveNotes);
  ui.speakButton.addEventListener("click", toggleTtsPlayback);
  ui.saveButton.addEventListener("click", persistActiveRecord);
  ui.deleteButton.addEventListener("click", deleteActiveRecord);

  ui.settingsButton.addEventListener("click", () => ui.settingsDialog.showModal());
  ui.saveSettingsButton.addEventListener("click", saveSettingsFromInputs);
  ui.resetSettingsButton.addEventListener("click", resetSettings);

  ui.installButton.addEventListener("click", installPwa);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    appState.deferredPrompt = event;
    ui.installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    appState.deferredPrompt = null;
    ui.installButton.hidden = true;
    showToast("App installed");
  });

  window.addEventListener("popstate", () => {
    handleRouteChange({ syncRoute: false });
  });
}

function applyStatus(stage, text) {
  if (stage === "stt") {
    setRecordingStatus(text);
  } else if (stage === "llm" || stage === "tts") {
    setAiStatus(text);
  }
}

function createAndSelectRecord(type) {
  const record = createRecord(type);
  appState.records.unshift(record);
  appState.activeId = record.id;
  renderList();
  renderLibraryList();
  renderEditor();
  void saveRecord(record).catch((error) => {
    console.error(error);
    showToast("Failed to save record");
  });
  return record;
}

function createRecord(type) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    title: getFlowConfig(type).fallbackTitle,
    manualNotes: "",
    transcript: "",
    meetingNotes: "",
    audioBlob: null,
    audioType: "",
    createdAt: now,
    updatedAt: now,
  };
}

function getActiveRecord() {
  return appState.records.find((record) => record.id === appState.activeId);
}

function updateDraftFromInputs() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  record.title = ui.titleInput.value.trim() || getFallbackTitle(ui.typeSelect.value);
  record.type = ui.typeSelect.value;
  record.manualNotes = ui.manualNotesInput.value.trim();
  record.transcript = ui.transcriptInput.value.trim();
  record.meetingNotes = ui.meetingNotesInput.value.trim();
  record.updatedAt = new Date().toISOString();
  applyWorkspaceMode(getFlowConfig(record.type));
  syncRecorderView(record);
  syncVoiceView(record);
  renderNotesPreviews(record);
  renderList();
  renderLibraryList();
  updateMetrics(record, false);
}

function updateVoiceDraftFromInputs() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  record.title = ui.voiceTitleInput.value.trim() || getFallbackTitle("voice-note");
  record.type = "voice-note";
  record.transcript = ui.voiceTranscriptInput.value.trim();
  record.meetingNotes = ui.voiceSummaryInput.value.trim();
  record.updatedAt = new Date().toISOString();
  ui.titleInput.value = record.title;
  ui.typeSelect.value = "voice-note";
  ui.transcriptInput.value = record.transcript;
  ui.meetingNotesInput.value = record.meetingNotes;
  syncVoiceView(record);
  renderNotesPreviews(record);
  renderList();
  renderLibraryList();
  updateMetrics(record, false);
}

function renderEditor() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  const config = getFlowConfig(record.type);
  ui.workspaceHeading.textContent =
    record.type === "meeting" ? "Meeting notes workspace." : "Voice note workspace.";
  ui.editorHeading.textContent = record.title;
  ui.titleInput.value = record.title;
  ui.typeSelect.value = record.type;
  ui.manualNotesInput.value = record.manualNotes;
  ui.transcriptInput.value = record.transcript;
  ui.meetingNotesInput.value = record.meetingNotes;
  ui.generateButton.textContent = config.generateLabel;
  applyWorkspaceMode(config);
  syncRecorderView(record);
  syncVoiceView(record);
  renderNotesPreviews(record);
  updateSpeakButtonLabel();

  if (appState.audioUrl) {
    URL.revokeObjectURL(appState.audioUrl);
    appState.audioUrl = null;
  }

  if (record.audioBlob instanceof Blob) {
    appState.audioUrl = URL.createObjectURL(record.audioBlob);
    ui.audioPlayer.src = appState.audioUrl;
    ui.audioPlayer.hidden = false;
    ui.recorderAudioPlayer.src = appState.audioUrl;
    ui.recorderAudioPlayer.hidden = false;
    ui.voiceAudioPlayer.src = appState.audioUrl;
    ui.voiceAudioPlayer.hidden = false;
  } else {
    ui.audioPlayer.removeAttribute("src");
    ui.audioPlayer.hidden = true;
    ui.recorderAudioPlayer.removeAttribute("src");
    ui.recorderAudioPlayer.hidden = true;
    ui.voiceAudioPlayer.removeAttribute("src");
    ui.voiceAudioPlayer.hidden = true;
  }

  updateMetrics(record, true);
  renderList();
  renderLibraryList();
}

function renderList() {
  const visibleRecords = getVisibleRecords(appState.records, {
    query: appState.query,
    filter: appState.filter,
  });

  ui.recordCount.textContent = formatItemCount(visibleRecords.length);

  if (!visibleRecords.length) {
    ui.recordList.innerHTML =
      '<div class="empty-state">No records match the current filter. Create a new capture or clear the search.</div>';
    return;
  }

  ui.recordList.innerHTML = createRecordListMarkup(visibleRecords, {
    activeId: appState.activeId,
    previewLength: 120,
    dataAttribute: "data-id",
  });

  ui.recordList.querySelectorAll(".record-card").forEach((button) => {
    button.addEventListener("click", () => {
      openRecord(button.dataset.id);
    });
  });
}

function renderLibraryList() {
  const records = getVisibleRecords(appState.records, {
    query: appState.libraryQuery,
  });

  ui.libraryRecordCount.textContent = formatItemCount(records.length);

  if (!records.length) {
    ui.libraryRecordList.innerHTML =
      '<div class="empty-state">No recordings match the current search.</div>';
    return;
  }

  ui.libraryRecordList.innerHTML = createRecordListMarkup(records, {
    previewLength: 160,
    dataAttribute: "data-library-id",
  });

  ui.libraryRecordList.querySelectorAll("[data-library-id]").forEach((button) => {
    button.addEventListener("click", () => openRecord(button.dataset.libraryId));
  });
}

function openRecord(recordId) {
  appState.activeId = recordId;
  renderEditor();
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  if (record.type === "meeting") {
    if (hasMeetingDraft(record)) {
      showWorkspace();
    } else {
      showRecorder();
    }
    return;
  }

  showVoiceShell();
}

async function startRecording() {
  if (appState.isRecording) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Microphone capture is not available in this browser");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickSupportedMimeType();
    appState.chunks = [];
    appState.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    appState.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) {
        appState.chunks.push(event.data);
      }
    });

    appState.mediaRecorder.addEventListener("stop", async () => {
      const type = appState.mediaRecorder?.mimeType || "audio/webm";
      const audioBlob = new Blob(appState.chunks, { type });
      const record = getActiveRecord();

      if (record) {
        record.audioBlob = audioBlob;
        record.audioType = type;
        record.updatedAt = new Date().toISOString();
        await saveRecord(record);
        appState.records = await getAllRecords();
        renderEditor();
        ui.recorderContinueButton.disabled = false;
        showToast("Recording attached");
        queueMicrotask(() => {
          void autoProcessRecord(record.id);
        });
      }

      stream.getTracks().forEach((track) => track.stop());
      setRecordingUiState(false);
      setRecordingStatus("Recorder idle");
    });

    appState.mediaRecorder.start();
    ui.recorderContinueButton.disabled = true;
    setRecordingUiState(true);
    setRecordingStatus("Recording live");
  } catch (error) {
    console.error(error);
    setRecordingUiState(false);
    showToast("Microphone permission or capture failed");
  }
}

function stopRecording() {
  if (!appState.mediaRecorder || !appState.isRecording) {
    return;
  }

  appState.mediaRecorder.stop();
}

async function transcribeActiveRecord() {
  const record = getActiveRecord();
  await runTranscription(record);
}

async function generateMeetingNotes() {
  const record = getActiveRecord();
  await runNoteGeneration(record);
}

async function rewriteActiveNotes() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  const presetKey =
    appState.currentView === "voice" ? ui.voiceRewriteSelect.value : ui.notesRewriteSelect.value;
  await runNotesRewrite(record, presetKey);
}

async function speakMeetingNotes() {
  const record = getActiveRecord();
  const text = record?.meetingNotes || record?.transcript || record?.manualNotes;
  if (!text) {
    showToast("No note content available for playback");
    return;
  }

  ui.speakButton.disabled = true;
  ui.voiceSpeakButton.disabled = true;
  appState.activeTasks.tts = true;
  setAiStatus("Preparing Kokoro");
  resetTtsPlayback();

  try {
    const request = callAI("synthesize", {
      text,
      voice: appState.settings.kokoroVoice,
    }, {
      onPartial: (payload, message) => {
        if (payload?.audioBuffer) {
          enqueueTtsChunk(message.id, payload.audioBuffer, payload.mimeType);
        }
      },
    });
    appState.ttsPlayback.activeRequestId = request.requestId;
    ui.speakButton.disabled = false;
    ui.voiceSpeakButton.disabled = false;
    updateSpeakButtonLabel();
    const response = await request;

    if (!response?.ok) {
      throw new Error("Kokoro did not finish streaming audio");
    }

    if (isTtsRequestCancelled(response.requestId)) {
      clearCancelledTtsRequest(response.requestId);
      return;
    }

    markTtsStreamDone(response.requestId);
    await waitForTtsPlaybackDrain(response.requestId);
    showToast("Playback complete");
  } catch (error) {
    console.error(error);
    resetTtsPlayback();
    showToast(error.message || "TTS failed");
  } finally {
    appState.activeTasks.tts = false;
    ui.speakButton.disabled = false;
    ui.voiceSpeakButton.disabled = false;
    setAiStatus("Notes generator idle");
    updateSpeakButtonLabel();
    restoreIdleStatus();
  }
}

async function persistActiveRecord() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  if (appState.currentView === "voice") {
    updateVoiceDraftFromInputs();
  } else {
    updateDraftFromInputs();
  }
  await saveRecord(record);
  appState.records = await getAllRecords();
  renderList();
  renderLibraryList();
  renderEditor();
  showToast("Record saved");
}

async function deleteActiveRecord() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  await removeRecord(record.id);
  appState.records = await getAllRecords();
  appState.activeId = appState.records[0]?.id ?? null;
  renderList();
  renderLibraryList();

  if (!appState.activeId) {
    showLibrary();
    showToast("Record deleted");
    return;
  }

  renderEditor();

  const nextRecord = getActiveRecord();
  if (appState.currentView === "voice" && nextRecord?.type === "meeting") {
    showWorkspace();
  } else if (appState.currentView === "workspace" && nextRecord?.type === "voice-note") {
    showVoiceShell();
  }

  showToast("Record deleted");
}

async function runTranscription(record, options = {}) {
  const {
    toastOnSuccess = true,
    toastOnError = true,
    successMessage = "Transcript ready",
    busyMessage = "Preparing audio",
  } = options;

  if (!record?.audioBlob) {
    if (toastOnError) {
      showToast("Record audio before transcription");
    }
    return false;
  }

  if (appState.activeTasks.stt) {
    return false;
  }

  ui.transcribeButton.disabled = true;
  ui.voiceTranscribeButton.disabled = true;
  appState.activeTasks.stt = true;
  setRecordingStatus(busyMessage);

  try {
    const waveform = await decodeAudioBlob(record.audioBlob, 16000);
    const response = await callAI(
      "transcribe",
      {
        audio: waveform.buffer,
        language: appState.settings.whisperLanguage,
      },
      {
        onPartial: (payload) => {
          record.transcript = payload.text || "";
          record.updatedAt = new Date().toISOString();

          if (appState.activeId === record.id) {
            ui.transcriptInput.value = record.transcript;
            ui.voiceTranscriptInput.value = record.transcript;
            updateMetrics(record, false);
          }
        },
      },
    );

    if (!response?.text) {
      throw new Error("Whisper did not return transcript text");
    }

    record.transcript = response.text.trim();
    record.updatedAt = new Date().toISOString();
    await saveRecord(record);
    appState.records = await getAllRecords();
    renderEditor();

    if (toastOnSuccess) {
      showToast(successMessage);
    }

    return true;
  } catch (error) {
    console.error(error);
    if (toastOnError) {
      showToast(error.message || "Transcription failed");
    }
    return false;
  } finally {
    appState.activeTasks.stt = false;
    ui.transcribeButton.disabled = false;
    ui.voiceTranscribeButton.disabled = false;
    restoreIdleStatus();
  }
}

async function runNoteGeneration(record, options = {}) {
  const {
    toastOnSuccess = true,
    toastOnError = true,
    successMessage = "Notes created",
    emptyMessage = "Add context or transcript before generating notes",
    busyMessage = "Preparing Qwen",
  } = options;

  if (!record) {
    return false;
  }

  const sourceMaterial = [record.manualNotes, record.transcript].filter(Boolean).join("\n\n");
  if (!sourceMaterial.trim()) {
    if (toastOnError) {
      showToast(emptyMessage);
    }
    return false;
  }

  if (appState.activeTasks.llm) {
    return false;
  }

  setLlmUiState(true);
  appState.activeTasks.llm = true;
  setAiStatus(busyMessage);

  const messages = buildNotesMessages(record);

  try {
    const response = await callAI(
      "generate",
      {
        messages,
        maxNewTokens: record.type === "meeting" ? 420 : 260,
      },
      {
        onPartial: (payload) => {
          record.meetingNotes = payload.text || "";
          record.updatedAt = new Date().toISOString();

          if (appState.activeId === record.id) {
            ui.meetingNotesInput.value = record.meetingNotes;
            ui.voiceSummaryInput.value = record.meetingNotes;
            renderNotesPreviews(record);
            updateMetrics(record, false);
          }
        },
      },
    );

    if (!response?.text) {
      throw new Error("Qwen did not return note content");
    }

    let finalNotes = sanitizeGeneratedNotes(response.text, record.type);

    if (needsNotesRepair(finalNotes)) {
      setAiStatus("Repairing draft");

      const repaired = await callAI("generate", {
        messages: buildRepairMessages(record, finalNotes),
        maxNewTokens: record.type === "meeting" ? 320 : 220,
      });

      finalNotes = sanitizeGeneratedNotes(repaired?.text || finalNotes, record.type);
    }

    record.meetingNotes = finalNotes;
    await maybeSuggestTitle(record);
    record.updatedAt = new Date().toISOString();
    await saveRecord(record);
    appState.records = await getAllRecords();
    renderEditor();

    if (toastOnSuccess) {
      showToast(successMessage);
    }

    return true;
  } catch (error) {
    console.error(error);
    if (toastOnError) {
      showToast(error.message || "Note generation failed");
    }
    return false;
  } finally {
    appState.activeTasks.llm = false;
    setLlmUiState(false);
    setAiStatus("Notes generator idle");
    restoreIdleStatus();
  }
}

async function runNotesRewrite(record, presetKey, options = {}) {
  const {
    toastOnSuccess = true,
    toastOnError = true,
  } = options;

  if (!record) {
    return false;
  }

  const sourceMaterial = [record.meetingNotes, record.transcript, record.manualNotes].filter(Boolean).join("\n\n");
  if (!sourceMaterial.trim()) {
    if (toastOnError) {
      showToast("Add transcript or notes before refining");
    }
    return false;
  }

  if (appState.activeTasks.llm) {
    return false;
  }

  const preset = REWRITE_PRESETS[presetKey] ?? REWRITE_PRESETS.professional;
  setLlmUiState(true);
  appState.activeTasks.llm = true;
  setAiStatus(preset.busyLabel);

  try {
    const response = await callAI(
      "generate",
      {
        messages: buildRewriteMessages(record, record.meetingNotes, presetKey),
        maxNewTokens: record.type === "meeting" ? 420 : 260,
      },
      {
        onPartial: (payload) => {
          record.meetingNotes = payload.text || "";
          record.updatedAt = new Date().toISOString();

          if (appState.activeId === record.id) {
            ui.meetingNotesInput.value = record.meetingNotes;
            ui.voiceSummaryInput.value = record.meetingNotes;
            renderNotesPreviews(record);
            updateMetrics(record, false);
          }
        },
      },
    );

    if (!response?.text) {
      throw new Error("Qwen did not return refined notes");
    }

    let finalNotes = sanitizeGeneratedNotes(response.text, record.type);

    if (needsNotesRepair(finalNotes)) {
      setAiStatus("Repairing draft");
      const repaired = await callAI("generate", {
        messages: buildRepairMessages(record, finalNotes),
        maxNewTokens: record.type === "meeting" ? 320 : 220,
      });
      finalNotes = sanitizeGeneratedNotes(repaired?.text || finalNotes, record.type);
    }

    record.meetingNotes = finalNotes;
    await maybeSuggestTitle(record);
    record.updatedAt = new Date().toISOString();
    await saveRecord(record);
    appState.records = await getAllRecords();
    renderEditor();

    if (toastOnSuccess) {
      showToast(`${preset.label} applied`);
    }

    return true;
  } catch (error) {
    console.error(error);
    if (toastOnError) {
      showToast(error.message || "Rewrite failed");
    }
    return false;
  } finally {
    appState.activeTasks.llm = false;
    setLlmUiState(false);
    setAiStatus("Notes generator idle");
    restoreIdleStatus();
  }
}

async function autoProcessRecord(recordId) {
  const record = appState.records.find((item) => item.id === recordId);
  if (!record?.audioBlob) {
    return;
  }

  const transcribed = await runTranscription(record, {
    toastOnSuccess: false,
    toastOnError: true,
    busyMessage: "Auto-transcribing recording",
  });

  if (!transcribed) {
    return;
  }

  const summarized = await runNoteGeneration(record, {
    toastOnSuccess: false,
    toastOnError: true,
    successMessage: record.type === "meeting" ? "Meeting notes ready" : "Voice note summary ready",
    busyMessage: record.type === "meeting" ? "Summarizing meeting" : "Summarizing voice note",
  });

  if (summarized) {
    showToast(record.type === "meeting" ? "Transcript and meeting notes ready" : "Transcript and summary ready");
  }
}

async function maybeSuggestTitle(record) {
  if (!record || hasCustomTitle(record)) {
    return false;
  }

  const sourceMaterial = [record.transcript, record.manualNotes, record.meetingNotes].filter(Boolean).join("\n\n");
  if (!sourceMaterial.trim()) {
    return false;
  }

  try {
    const response = await callAI("generate", {
      messages: buildTitleMessages(record),
      maxNewTokens: 32,
    });

    const nextTitle = sanitizeGeneratedTitle(response?.text, getFallbackTitle(record.type));
    if (!nextTitle || nextTitle === getFallbackTitle(record.type)) {
      return false;
    }

    record.title = nextTitle;

    if (appState.activeId === record.id) {
      ui.titleInput.value = nextTitle;
      ui.voiceTitleInput.value = record.type === "voice-note" ? nextTitle : ui.voiceTitleInput.value;
      ui.recorderTitleInput.value = nextTitle;
    }

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function callAI(action, payload, handlers = {}) {
  return aiClient.call(action, payload, handlers);
}

function updateMetrics(record, saved) {
  ui.editorHeading.textContent = record.title;
  ui.modeMetric.textContent = getFlowConfig(record.type).label;
  ui.transcriptMetric.textContent = `${countWords(record.transcript)} words`;
  ui.savedMetric.textContent = saved ? formatDate(record.updatedAt) : "Draft";
  ui.voiceSavedMetric.textContent = saved ? formatDate(record.updatedAt) : "Draft";
}

function showLanding(options = {}) {
  const { syncRoute = true, replace = false } = options;
  if (appState.isRecording) {
    showToast("Stop recording first");
    return;
  }

  appState.currentView = "landing";
  document.body.dataset.view = "landing";
  ui.landingShell.hidden = false;
  ui.recorderShell.hidden = true;
  ui.voiceShell.hidden = true;
  ui.libraryShell.hidden = true;
  ui.appShell.hidden = true;
  stopTtsPlayback({ silent: true });

  if (syncRoute) {
    syncRouteWithHistory(ROUTES.landing, { replace });
  }
}

function showRecorder(options = {}) {
  const { syncRoute = true, replace = false } = options;
  appState.currentView = "recorder";
  document.body.dataset.view = "recorder";
  ui.landingShell.hidden = true;
  ui.recorderShell.hidden = false;
  ui.voiceShell.hidden = true;
  ui.libraryShell.hidden = true;
  ui.appShell.hidden = true;

  if (syncRoute) {
    syncRouteWithHistory(ROUTES.meetings, { replace });
  }
}

function showVoiceShell(options = {}) {
  const { syncRoute = true, replace = false } = options;
  appState.currentView = "voice";
  document.body.dataset.view = "voice";
  ui.landingShell.hidden = true;
  ui.recorderShell.hidden = true;
  ui.voiceShell.hidden = false;
  ui.libraryShell.hidden = true;
  ui.appShell.hidden = true;

  if (syncRoute) {
    syncRouteWithHistory(ROUTES.notes, { replace });
  }
}

function showLibrary(options = {}) {
  const { syncRoute = true, replace = false } = options;
  if (appState.isRecording) {
    showToast("Stop recording first");
    return;
  }

  appState.currentView = "library";
  document.body.dataset.view = "library";
  renderLibraryList();
  ui.landingShell.hidden = true;
  ui.recorderShell.hidden = true;
  ui.voiceShell.hidden = true;
  ui.libraryShell.hidden = false;
  ui.appShell.hidden = true;

  if (syncRoute) {
    syncRouteWithHistory(ROUTES.recordings, { replace });
  }
}

function showWorkspace(options = {}) {
  const { syncRoute = true, replace = false } = options;
  appState.currentView = "workspace";
  document.body.dataset.view = "workspace";
  ui.landingShell.hidden = true;
  ui.recorderShell.hidden = true;
  ui.voiceShell.hidden = true;
  ui.libraryShell.hidden = true;
  ui.appShell.hidden = false;

  if (syncRoute) {
    syncRouteWithHistory(ROUTES.meetings, { replace });
  }
}

function handleRouteChange(options = {}) {
  const { syncRoute = true, replace = false } = options;
  const path = normalizePath(window.location.pathname);

  if (path === ROUTES.recordings) {
    showLibrary({ syncRoute, replace });
    return;
  }

  if (path === ROUTES.notes) {
    const record = ensureActiveRecord("voice-note");
    renderEditor();
    syncVoiceView(record);
    showVoiceShell({ syncRoute, replace });
    return;
  }

  if (path === ROUTES.meetings) {
    const record = ensureActiveRecord("meeting");
    renderEditor();

    if (hasMeetingDraft(record)) {
      showWorkspace({ syncRoute, replace });
    } else {
      syncRecorderView(record);
      showRecorder({ syncRoute, replace });
    }
    return;
  }

  showLanding({ syncRoute, replace });
}

function ensureActiveRecord(type) {
  const activeRecord = getActiveRecord();
  if (activeRecord?.type === type) {
    return activeRecord;
  }

  const existing = appState.records.find((record) => record.type === type);
  if (existing) {
    appState.activeId = existing.id;
    return existing;
  }

  return createAndSelectRecord(type);
}

function hasMeetingDraft(record) {
  if (!record) {
    return false;
  }

  return Boolean(
    record.audioBlob instanceof Blob ||
      record.manualNotes.trim() ||
      record.transcript.trim() ||
      record.meetingNotes.trim(),
  );
}

function hasCustomTitle(record) {
  if (!record) {
    return false;
  }

  const title = record.title?.trim();
  return Boolean(title && title !== getFallbackTitle(record.type));
}

function syncRouteWithHistory(path, options = {}) {
  const normalizedPath = normalizePath(path);
  if (normalizePath(window.location.pathname) === normalizedPath) {
    return;
  }

  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", normalizedPath);
}

function applyWorkspaceMode(config) {
  ui.composeHeading.textContent = config.composeHeading;
  ui.manualNotesLabel.textContent = config.manualNotesLabel;
  ui.manualNotesInput.placeholder = config.manualNotesPlaceholder;
  ui.transcriptInput.placeholder = config.transcriptPlaceholder;
  ui.meetingNotesInput.placeholder = config.notesPlaceholder;
  renderNotesPreviews(getActiveRecord());
}

function createAndShowMeetingRecorder() {
  if (appState.isRecording) {
    showToast("Stop recording first");
    return;
  }

  const record = createAndSelectRecord("meeting");
  syncRecorderView(record);
  showRecorder();
}

function createAndShowVoiceNote() {
  if (appState.isRecording) {
    showToast("Stop recording first");
    return;
  }

  const record = createAndSelectRecord("voice-note");
  syncVoiceView(record);
  showVoiceShell();
}

function continueToWorkspace() {
  if (appState.isRecording) {
    showToast("Stop recording first");
    return;
  }

  renderEditor();
  showWorkspace();
}

function syncRecorderView(record = getActiveRecord()) {
  if (!record) {
    return;
  }

  const config = getFlowConfig(record.type);
  ui.recorderEyebrow.textContent = config.label;
  ui.recorderHeading.textContent =
    record.type === "meeting" ? "Record the meeting first." : "Record the voice note first.";
  ui.recorderTitleInput.value = record.title === config.fallbackTitle ? "" : record.title;
  ui.recorderTitleInput.placeholder =
    record.type === "meeting"
      ? "Board sync, sprint review, interview loop..."
      : "Voice memo, follow-up, idea capture...";
  ui.recorderContinueButton.disabled = !(record.audioBlob instanceof Blob);
}

function syncVoiceView(record = getActiveRecord()) {
  if (!record) {
    return;
  }

  const title = record.title === getFallbackTitle("voice-note") ? "" : record.title;
  ui.voiceHeading.textContent =
    record.audioBlob instanceof Blob ? "Voice note ready to refine." : "Capture a quick note.";
  ui.voiceTitleInput.value = record.type === "voice-note" ? title : record.title;
  ui.voiceTranscriptInput.value = record.type === "voice-note" ? record.transcript : "";
  ui.voiceSummaryInput.value = record.type === "voice-note" ? record.meetingNotes : "";
  renderNotesPreviews(record);
  ui.voiceSavedMetric.textContent = formatDate(record.updatedAt);
  updateVoiceSpeakButtonLabel();
}

function renderNotesPreviews(record = getActiveRecord()) {
  const notes = record?.meetingNotes || "";

  ui.meetingNotesPreview.innerHTML = renderMarkdown(
    notes,
    "Generated notes will render here once the draft is ready.",
  );

  ui.voiceSummaryPreview.innerHTML = renderMarkdown(
    record?.type === "voice-note" ? notes : "",
    "The summary preview shows up here.",
  );
}

function setMarkdownTab(scope, mode) {
  const isPreview = mode === "preview";
  const refs =
    scope === "voice"
      ? {
          previewTab: ui.voicePreviewTab,
          rawTab: ui.voiceRawTab,
          previewPane: ui.voicePreviewPane,
          rawPane: ui.voiceRawPane,
        }
      : {
          previewTab: ui.notesPreviewTab,
          rawTab: ui.notesRawTab,
          previewPane: ui.notesPreviewPane,
          rawPane: ui.notesRawPane,
        };

  refs.previewTab.classList.toggle("active", isPreview);
  refs.rawTab.classList.toggle("active", !isPreview);
  refs.previewTab.setAttribute("aria-selected", String(isPreview));
  refs.rawTab.setAttribute("aria-selected", String(!isPreview));
  refs.previewTab.tabIndex = isPreview ? 0 : -1;
  refs.rawTab.tabIndex = isPreview ? -1 : 0;
  refs.previewPane.hidden = !isPreview;
  refs.rawPane.hidden = isPreview;
}

function syncRecorderTitle() {
  const record = getActiveRecord();
  if (!record) {
    return;
  }

  const nextTitle = ui.recorderTitleInput.value.trim() || getFallbackTitle(record.type);
  record.title = nextTitle;
  record.updatedAt = new Date().toISOString();
  ui.titleInput.value = nextTitle;
  updateMetrics(record, false);
  renderList();
}

function setRecordingStatus(text) {
  ui.recordingStatus.textContent = text;
  ui.recorderStatus.textContent = text;
  ui.voiceRecordingStatus.textContent = text;
}

function setRecordingUiState(isRecording) {
  appState.isRecording = isRecording;
  document.body.classList.toggle("is-recording", isRecording);
  ui.recorderStartButton.disabled = isRecording;
  ui.recorderStopButton.disabled = !isRecording;
  ui.voiceStartButton.disabled = isRecording;
  ui.voiceStopButton.disabled = !isRecording;
}

function setAiStatus(text) {
  ui.llmStatus.textContent = text;
  ui.voiceAiStatus.textContent = text;
}

function setLlmUiState(isBusy) {
  ui.generateButton.disabled = isBusy;
  ui.voiceGenerateButton.disabled = isBusy;
  ui.notesRewriteButton.disabled = isBusy;
  ui.voiceRewriteButton.disabled = isBusy;
}

function updateCapabilityLabels() {
  ui.runtimeMetric.textContent = navigator.gpu ? "GPU if available" : "Browser runtime";
}

function resetTtsPlayback() {
  const playback = appState.ttsPlayback;

  if (playback.currentAudio) {
    playback.currentAudio.pause();
    playback.currentAudio.src = "";
    playback.currentAudio = null;
  }

  playback.queue.forEach((item) => URL.revokeObjectURL(item.url));
  playback.queue = [];
  playback.streamDone = false;
  resolveTtsPlaybackDrainers();
}

function enqueueTtsChunk(requestId, audioBuffer, mimeType) {
  const playback = appState.ttsPlayback;

  if (playback.activeRequestId == null) {
    playback.activeRequestId = requestId;
  }

  if (playback.activeRequestId !== requestId) {
    return;
  }

  if (isTtsRequestCancelled(requestId)) {
    return;
  }

  const blob = new Blob([audioBuffer], { type: mimeType || "audio/wav" });
  const url = URL.createObjectURL(blob);
  playback.queue.push({ url });
  playNextTtsChunk();
}

function playNextTtsChunk() {
  const playback = appState.ttsPlayback;

  if (playback.currentAudio || !playback.queue.length) {
    resolveTtsPlaybackDrainers();
    return;
  }

  const next = playback.queue.shift();
  const audio = new Audio(next.url);
  playback.currentAudio = audio;

  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(next.url);
    playback.currentAudio = null;
    playNextTtsChunk();
  }, { once: true });

  audio.addEventListener("error", () => {
    URL.revokeObjectURL(next.url);
    playback.currentAudio = null;
    playNextTtsChunk();
  }, { once: true });

  audio.play().catch(() => {
    URL.revokeObjectURL(next.url);
    playback.currentAudio = null;
    playNextTtsChunk();
  });
}

function markTtsStreamDone(requestId) {
  const playback = appState.ttsPlayback;
  if (playback.activeRequestId === requestId && !isTtsRequestCancelled(requestId)) {
    playback.streamDone = true;
    resolveTtsPlaybackDrainers();
  }
}

function waitForTtsPlaybackDrain(requestId) {
  const playback = appState.ttsPlayback;

  return new Promise((resolve) => {
    playback.drainResolvers.push({ requestId, resolve });
    resolveTtsPlaybackDrainers();
  });
}

function resolveTtsPlaybackDrainers() {
  const playback = appState.ttsPlayback;
  const shouldDrain =
    playback.streamDone && playback.activeRequestId != null && !playback.currentAudio && !playback.queue.length;

  if (!shouldDrain) {
    return;
  }

  const requestId = playback.activeRequestId;
  const pending = playback.drainResolvers;
  playback.drainResolvers = [];
  playback.activeRequestId = null;
  playback.streamDone = false;

  pending.forEach((entry) => {
    if (entry.requestId === requestId) {
      entry.resolve();
    } else {
      playback.drainResolvers.push(entry);
    }
  });
}

function toggleTtsPlayback() {
  if (appState.activeTasks.tts) {
    stopTtsPlayback();
    return;
  }

  speakMeetingNotes();
}

function stopTtsPlayback(options = {}) {
  const { silent = false } = options;
  const playback = appState.ttsPlayback;
  const requestId = playback.activeRequestId;

  if (requestId != null) {
    playback.cancelledRequestIds.add(requestId);
  }

  resetTtsPlayback();
  appState.activeTasks.tts = false;
  setAiStatus("Playback stopped");
  updateSpeakButtonLabel();
  restoreIdleStatus();
  if (!silent) {
    showToast("Playback stopped");
  }
}

function updateSpeakButtonLabel() {
  ui.speakButton.textContent = appState.activeTasks.tts ? "Stop playback" : "Play audio";
  updateVoiceSpeakButtonLabel();
}

function updateVoiceSpeakButtonLabel() {
  ui.voiceSpeakButton.textContent = appState.activeTasks.tts ? "Stop playback" : "Play audio";
}

async function copyMeetingNotes() {
  await copyToClipboard(ui.meetingNotesInput.value, "Notes copied");
}

async function copyVoiceSummary() {
  await copyToClipboard(ui.voiceSummaryInput.value, "Summary copied");
}

async function copyToClipboard(value, successMessage) {
  const text = String(value || "").trim();
  if (!text) {
    showToast("Nothing to copy");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (error) {
    console.error(error);
    showToast("Clipboard access failed");
  }
}

function isTtsRequestCancelled(requestId) {
  return appState.ttsPlayback.cancelledRequestIds.has(requestId);
}

function clearCancelledTtsRequest(requestId) {
  appState.ttsPlayback.cancelledRequestIds.delete(requestId);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => ui.toast.classList.remove("visible"), 2600);
}

function restoreIdleStatus() {
  if (!appState.activeTasks.stt) {
    setRecordingStatus("Recorder idle");
  }

  if (!appState.activeTasks.llm && !appState.activeTasks.tts) {
    ui.llmStatus.textContent = "Notes generator idle";
    ui.voiceAiStatus.textContent = "Summary idle";
  }
}

function renderSettings() {
  ui.sttEndpointInput.value = appState.settings.whisperModel;
  ui.sttModelInput.value = appState.settings.whisperLanguage;
  ui.llmEndpointInput.value = appState.settings.qwenModel;
  ui.llmModelInput.value = appState.settings.qwenDtype;
  ui.ttsEndpointInput.value = appState.settings.kokoroModel;
  ui.ttsModelInput.value = appState.settings.kokoroDtype;
  ui.ttsVoiceInput.value = appState.settings.kokoroVoice;
}

function saveSettingsFromInputs() {
  appState.settings = {
    whisperModel: ui.sttEndpointInput.value.trim() || DEFAULT_SETTINGS.whisperModel,
    whisperLanguage: ui.sttModelInput.value.trim() || DEFAULT_SETTINGS.whisperLanguage,
    qwenModel: ui.llmEndpointInput.value.trim() || DEFAULT_SETTINGS.qwenModel,
    qwenDtype: ui.llmModelInput.value.trim() || DEFAULT_SETTINGS.qwenDtype,
    kokoroModel: ui.ttsEndpointInput.value.trim() || DEFAULT_SETTINGS.kokoroModel,
    kokoroDtype: ui.ttsModelInput.value.trim() || DEFAULT_SETTINGS.kokoroDtype,
    kokoroVoice: ui.ttsVoiceInput.value.trim() || DEFAULT_SETTINGS.kokoroVoice,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.settings));
  aiClient.reconfigure();
  ui.settingsDialog.close();
  showToast("Model settings updated");
}

function resetSettings() {
  appState.settings = { ...DEFAULT_SETTINGS };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.settings));
  renderSettings();
  aiClient.reconfigure();
  showToast("Defaults restored");
}

async function installPwa() {
  if (!appState.deferredPrompt) {
    showToast("Install is available from your browser menu");
    return;
  }

  appState.deferredPrompt.prompt();
  await appState.deferredPrompt.userChoice;
  appState.deferredPrompt = null;
  ui.installButton.hidden = true;
}

function registerServiceWorker() {
  if (window.__SONICFLOW_SINGLE_FILE__ || !("serviceWorker" in navigator)) {
    return Promise.resolve();
  }

  return navigator.serviceWorker.register("/sw.js");
}
