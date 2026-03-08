import {
  env,
  pipeline,
  TextStreamer,
} from "https://esm.sh/@huggingface/transformers@3.8.1";
import { KokoroTTS } from "https://esm.sh/kokoro-js@1.2.1";

env.allowLocalModels = false;
env.useBrowserCache = true;

const DEFAULT_SETTINGS = {
  whisperModel: "Xenova/whisper-tiny.en",
  whisperLanguage: "en",
  qwenModel: "onnx-community/Qwen2.5-0.5B-Instruct",
  qwenDtype: "q4",
  kokoroModel: "onnx-community/Kokoro-82M-v1.0-ONNX",
  kokoroDtype: "q8",
  kokoroVoice: "af_bella",
};

const runtime = {
  settings: { ...DEFAULT_SETTINGS },
  stt: null,
  llm: null,
  tts: null,
  keys: {
    stt: "",
    llm: "",
    tts: "",
  },
};

self.addEventListener("message", (event) => {
  handleMessage(event.data).catch((error) => {
    if (event.data?.id) {
      self.postMessage({
        type: "error",
        id: event.data.id,
        error: error.message || String(error),
      });
    }
  });
});

async function handleMessage(message) {
  if (message.type === "configure") {
    runtime.settings = { ...DEFAULT_SETTINGS, ...(message.payload?.settings || {}) };
    runtime.stt = null;
    runtime.llm = null;
    runtime.tts = null;
    runtime.keys = { stt: "", llm: "", tts: "" };
    self.postMessage({ type: "status", stage: "stt", text: "Whisper ready to load" });
    self.postMessage({ type: "status", stage: "llm", text: "Qwen ready to load" });
    self.postMessage({ type: "status", stage: "tts", text: "Kokoro ready to load" });
    return;
  }

  if (message.type === "transcribe") {
    const payload = await transcribeAudio(message.id, message.payload || {});
    self.postMessage({ type: "result", id: message.id, payload });
    return;
  }

  if (message.type === "generate") {
    const payload = await generateNotes(message.id, message.payload || {});
    self.postMessage({ type: "result", id: message.id, payload });
    return;
  }

  if (message.type === "synthesize") {
    const payload = await synthesizeSpeech(message.id, message.payload || {});
    self.postMessage({ type: "result", id: message.id, payload });
  }
}

async function transcribeAudio(requestId, { audio, language }) {
  const recognizer = await getRecognizer();
  self.postMessage({ type: "status", stage: "stt", text: "Running Whisper" });
  const waveform = new Float32Array(audio);
  const chunkSize = 16000 * 12;
  const totalChunks = Math.max(1, Math.ceil(waveform.length / chunkSize));
  let combinedText = "";

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(waveform.length, start + chunkSize);
    const segment = waveform.slice(start, end);
    const text = await transcribeChunk(recognizer, segment, language);
    combinedText = `${combinedText} ${text}`.trim();
    self.postMessage({
      type: "partial",
      id: requestId,
      payload: {
        text: combinedText,
        chunk: index + 1,
        totalChunks,
      },
    });
    self.postMessage({
      type: "status",
      stage: "stt",
      text: `Transcribing audio ${index + 1}/${totalChunks}`,
    });
  }

  return { text: combinedText };
}

async function generateNotes(requestId, { messages, maxNewTokens }) {
  const generator = await getGenerator();
  self.postMessage({ type: "status", stage: "llm", text: "Running Qwen" });
  const streamedText = { value: "" };
  const prompt = buildPrompt(messages);
  const result = await generator(prompt, {
    max_new_tokens: maxNewTokens || 320,
    do_sample: false,
    repetition_penalty: 1.18,
    no_repeat_ngram_size: 4,
    return_full_text: false,
    streamer: createTextStreamer(generator, requestId, streamedText),
  });

  const first = Array.isArray(result) ? result[0] : result;
  return { text: extractGeneratedText(first) || streamedText.value };
}

async function synthesizeSpeech(requestId, { text, voice }) {
  const tts = await getSpeaker();
  self.postMessage({ type: "status", stage: "tts", text: "Streaming Kokoro" });
  let chunkCount = 0;

  for await (const chunk of tts.stream(text, {
    voice: voice || runtime.settings.kokoroVoice,
  })) {
    const blob = await chunkToBlob(chunk);
    const audioBuffer = await blob.arrayBuffer();
    chunkCount += 1;
    self.postMessage(
      {
        type: "partial",
        id: requestId,
        payload: {
          audioBuffer,
          mimeType: blob.type || "audio/wav",
          chunkCount,
        },
      },
      [audioBuffer],
    );
  }

  return { ok: true, requestId, chunkCount };
}

async function getRecognizer() {
  const key = `${runtime.settings.whisperModel}`;
  if (runtime.stt && runtime.keys.stt === key) {
    return runtime.stt;
  }

  runtime.stt = await loadPipelineWithFallback(
    "automatic-speech-recognition",
    runtime.settings.whisperModel,
    {
      device: chooseDevice("stt"),
      progress_callback: createProgressReporter("stt", "Loading Whisper"),
    },
    "stt",
  );
  normalizeWhisperGenerationConfig(runtime.stt, runtime.settings.whisperModel);
  runtime.keys.stt = key;
  return runtime.stt;
}

async function getGenerator() {
  const key = `${runtime.settings.qwenModel}:${runtime.settings.qwenDtype}`;
  if (runtime.llm && runtime.keys.llm === key) {
    return runtime.llm;
  }

  runtime.llm = await loadPipelineWithFallback(
    "text-generation",
    runtime.settings.qwenModel,
    {
      device: chooseDevice("llm"),
      dtype: runtime.settings.qwenDtype || "q4",
      progress_callback: createProgressReporter("llm", "Loading Qwen"),
    },
    "llm",
  );
  runtime.keys.llm = key;
  return runtime.llm;
}

async function getSpeaker() {
  const key = `${runtime.settings.kokoroModel}:${runtime.settings.kokoroDtype}`;
  if (runtime.tts && runtime.keys.tts === key) {
    return runtime.tts;
  }

  const initialDevice = chooseDevice("tts");
  self.postMessage({ type: "status", stage: "tts", text: "Loading Kokoro" });

  try {
    runtime.tts = await KokoroTTS.from_pretrained(runtime.settings.kokoroModel, {
      device: initialDevice,
      dtype: runtime.settings.kokoroDtype || "q8",
      progress_callback: createProgressReporter("tts", "Loading Kokoro"),
    });
  } catch (error) {
    if (initialDevice === "webgpu") {
      self.postMessage({
        type: "status",
        stage: "tts",
        text: "Kokoro WebGPU failed, retrying with WASM",
      });
      runtime.tts = await KokoroTTS.from_pretrained(runtime.settings.kokoroModel, {
        device: "wasm",
        dtype: runtime.settings.kokoroDtype || "q8",
        progress_callback: createProgressReporter("tts", "Loading Kokoro"),
      });
    } else {
      throw error;
    }
  }

  runtime.keys.tts = key;
  return runtime.tts;
}

async function loadPipelineWithFallback(task, model, options, stage) {
  try {
    return await pipeline(task, model, options);
  } catch (error) {
    if (options.device === "webgpu") {
      self.postMessage({
        type: "status",
        stage,
        text: "WebGPU failed, retrying with WASM",
      });
      return pipeline(task, model, {
        ...options,
        device: "wasm",
      });
    }

    throw error;
  }
}

function chooseDevice(kind) {
  if (kind === "tts") {
    return "wasm";
  }

  return "gpu" in navigator ? "webgpu" : "wasm";
}

function createProgressReporter(stage, label) {
  return (progress) => {
    const raw = typeof progress?.progress === "number" ? progress.progress : null;
    const normalized = raw == null ? null : raw <= 1 ? raw * 100 : raw;
    self.postMessage({
      type: "progress",
      stage,
      text: label,
      progress: normalized,
    });
  };
}

function createTextStreamer(generator, requestId, streamedText) {
  return new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    callback_function: (text) => {
      streamedText.value += text;
      self.postMessage({
        type: "partial",
        id: requestId,
        payload: {
          text: streamedText.value,
          delta: text,
        },
      });
    },
  });
}

async function chunkToBlob(chunk) {
  if (typeof chunk?.toBlob === "function") {
    return chunk.toBlob();
  }

  if (typeof chunk?.audio?.toBlob === "function") {
    return chunk.audio.toBlob();
  }

  throw new Error("Kokoro stream chunk did not expose audio data");
}

function extractGeneratedText(result) {
  if (!result) {
    return "";
  }

  if (typeof result.generated_text === "string") {
    return result.generated_text;
  }

  if (Array.isArray(result.generated_text)) {
    return result.generated_text
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (typeof item?.content === "string") {
          return item.content;
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function isEnglishOnlyWhisperModel(modelName) {
  return /\.en($|[^a-z])/i.test(modelName || "");
}

function shouldRetryWithoutLanguage(error) {
  const message = error?.message || String(error);
  return (
    message.includes("Cannot specify `task` or `language` for an English-only model") ||
    message.includes("English-only model")
  );
}

function normalizeWhisperGenerationConfig(recognizer, modelName) {
  if (!isEnglishOnlyWhisperModel(modelName)) {
    return;
  }

  const generationConfig =
    recognizer?.model?.generation_config ||
    recognizer?.model?.config?.generation_config ||
    recognizer?.processor?.generation_config;

  if (!generationConfig) {
    return;
  }

  if ("language" in generationConfig) {
    generationConfig.language = null;
  }

  if ("task" in generationConfig) {
    generationConfig.task = null;
  }

  if ("is_multilingual" in generationConfig) {
    generationConfig.is_multilingual = false;
  }
}

async function transcribeChunk(recognizer, audio, language) {
  const baseOptions = {
    chunk_length_s: 12,
    stride_length_s: 2,
    return_timestamps: false,
  };
  const shouldForceEnglishDefaults = isEnglishOnlyWhisperModel(runtime.settings.whisperModel);
  const options = shouldForceEnglishDefaults
    ? baseOptions
    : {
        ...baseOptions,
        language: language || runtime.settings.whisperLanguage || undefined,
        task: "transcribe",
      };

  try {
    const result = await recognizer(audio, options);
    return result?.text || "";
  } catch (error) {
    if (!shouldRetryWithoutLanguage(error)) {
      throw error;
    }

    const result = await recognizer(audio, baseOptions);
    return result?.text || "";
  }
}

function buildPrompt(messages) {
  return messages
    .map((message) => {
      const role = message.role === "system" ? "System" : message.role === "assistant" ? "Assistant" : "User";
      return `${role}:\n${message.content}`;
    })
    .join("\n\n")
    .concat("\n\nAssistant:\n");
}
