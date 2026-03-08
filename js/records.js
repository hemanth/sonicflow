import { getFlowConfig } from "./config.js";
import { escapeHtml, formatDate, trimPreview } from "./utils.js";

function buildSearchText(record) {
  return `${record.title} ${record.manualNotes} ${record.transcript} ${record.meetingNotes}`
    .toLowerCase()
    .trim();
}

export function getVisibleRecords(records, { query = "", filter = "all" } = {}) {
  return [...records]
    .filter((record) => filter === "all" || record.type === filter)
    .filter((record) => !query || buildSearchText(record).includes(query))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function formatItemCount(count) {
  return `${count} item${count === 1 ? "" : "s"}`;
}

export function createRecordListMarkup(
  records,
  {
    activeId = null,
    previewLength = 120,
    dataAttribute = "data-record-id",
  } = {},
) {
  return records
    .map((record) => {
      const preview = record.meetingNotes || record.transcript || record.manualNotes || "No content yet";
      const activeClass = record.id === activeId ? " active" : "";

      return `
        <button type="button" class="record-card${activeClass}" ${dataAttribute}="${record.id}">
          <div class="record-meta">${getFlowConfig(record.type).label} · ${formatDate(record.updatedAt)}</div>
          <p class="record-title">${escapeHtml(record.title)}</p>
          <div class="record-preview">${escapeHtml(trimPreview(preview, previewLength))}</div>
        </button>
      `;
    })
    .join("");
}
