export function trimPreview(text, length) {
  if (text.length <= length) {
    return text;
  }

  return `${text.slice(0, length).trim()}...`;
}

export function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pickSupportedMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function normalizePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) || "/" : pathname;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return false;
  }

  try {
    return navigator.storage.persist();
  } catch {
    return false;
  }
}
