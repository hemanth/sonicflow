export function createAIClient({ getSettings, onStatus, onError }) {
  let worker = null;
  let workerUrl = null;
  let requestId = 0;
  const requests = new Map();

  function ensureWorker() {
    if (worker) {
      return worker;
    }

    const inlineWorker = window.__SONICFLOW_INLINE_WORKER__;
    if (typeof inlineWorker === "string" && inlineWorker.trim()) {
      workerUrl = URL.createObjectURL(new Blob([inlineWorker], { type: "text/javascript" }));
      worker = new Worker(workerUrl, { type: "module" });
    } else {
      worker = new Worker("/ai-worker.js?v=5", { type: "module" });
    }
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", (event) => {
      onError(event);
    });
    worker.postMessage({
      type: "configure",
      payload: { settings: getSettings() },
    });
    return worker;
  }

  function scheduleWarmup() {
    const warmup = () => ensureWorker();

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(warmup, { timeout: 1200 });
      return;
    }

    window.setTimeout(warmup, 400);
  }

  function handleMessage(event) {
    const message = event.data || {};

    if (message.type === "status") {
      onStatus(message.stage, message.text);
      return;
    }

    if (message.type === "progress") {
      const suffix =
        typeof message.progress === "number" ? ` ${Math.round(message.progress)}%` : "";
      onStatus(message.stage, `${message.text || "Downloading model"}${suffix}`);
      return;
    }

    const request = requests.get(message.id);
    if (!request) {
      return;
    }

    if (message.type === "partial") {
      request.onPartial?.(message.payload, message);
      return;
    }

    requests.delete(message.id);

    if (message.type === "result") {
      request.resolve(message.payload);
      return;
    }

    if (message.type === "error") {
      request.reject(new Error(message.error || "AI task failed"));
    }
  }

  function call(action, payload, handlers = {}) {
    const id = ++requestId;
    const transfer = [];

    if (payload?.audio instanceof ArrayBuffer) {
      transfer.push(payload.audio);
    }

    const promise = new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject, ...handlers });
      ensureWorker().postMessage({ id, type: action, payload }, transfer);
    });

    promise.requestId = id;
    return promise;
  }

  function reconfigure() {
    if (!worker) {
      return;
    }

    worker.postMessage({
      type: "configure",
      payload: { settings: getSettings() },
    });
  }

  return {
    call,
    ensureWorker,
    reconfigure,
    scheduleWarmup,
  };
}
