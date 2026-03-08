import { getFlowConfig } from "./config.js";

export const REWRITE_PRESETS = {
  grammar: {
    label: "Fix grammar",
    busyLabel: "Fixing grammar",
    instruction:
      "Fix grammar, spelling, punctuation, and awkward phrasing. Keep the same meaning and structure.",
  },
  professional: {
    label: "Make professional",
    busyLabel: "Polishing notes",
    instruction:
      "Rewrite in a polished professional tone suitable for sharing with colleagues or stakeholders. Keep the content factual and direct.",
  },
  concise: {
    label: "Tighten writing",
    busyLabel: "Tightening notes",
    instruction:
      "Make the writing tighter and clearer. Remove filler, repetition, and weak phrasing without losing meaning.",
  },
  executive: {
    label: "Executive summary",
    busyLabel: "Creating executive summary",
    instruction:
      "Rewrite for an executive audience. Lead with the outcome, key decision points, material risks, and immediate next steps. Keep it compact and high signal.",
  },
};

export function buildNotesMessages(record) {
  const system =
    record.type === "meeting"
      ? [
          "You are an exacting meeting-notes editor.",
          "Return markdown only.",
          "Use exactly these top-level sections in this order:",
          "## Summary",
          "## Decisions",
          "## Action Items",
          "## Risks",
          "## Open Questions",
          "## Next Steps",
          "Your job is to turn rough meeting transcripts into notes that someone could actually share after the meeting.",
          "Rules:",
          "- No nested bullets.",
          "- Use flat bullets only.",
          "- Every bullet must contain concrete information from the transcript or manual notes.",
          "- Do not invent facts, owners, deadlines, or decisions.",
          "- If something is implied but not explicit, write it cautiously or put it under Open Questions.",
          "- Never output placeholders like 'Action:' or 'Decision:' without content.",
          "- If a section has nothing useful, write '- None.'",
          "- Keep it short, direct, and readable.",
          "Section guidance:",
          "- Summary: 2 to 4 bullets on what the meeting was about, what changed, and the main outcome.",
          "- Decisions: only include clear decisions or agreements that were actually made.",
          "- Action Items: only include concrete follow-ups. Include owner and timing only if stated. If owner is missing, say 'Owner not specified.'",
          "- Risks: only include blockers, concerns, dependencies, or failure points that were explicitly raised.",
          "- Open Questions: capture unresolved issues, pending confirmations, or unclear points from the discussion.",
          "- Next Steps: list the immediate follow-on steps that are most likely to happen next.",
          "Quality bar:",
          "- Prefer fewer strong bullets over many weak ones.",
          "- Remove filler, repetition, and transcript noise.",
          "- Rewrite spoken language into clean written language without changing meaning.",
        ].join("\n")
      : [
          "You write clean, concise voice note summaries from rough transcripts.",
          "Return markdown only.",
          "Use exactly these top-level sections in this order:",
          "## Summary",
          "## Key Points",
          "## Follow-Up",
          "Rules:",
          "- No nested bullets.",
          "- Use flat bullets only.",
          "- Every bullet must contain concrete information.",
          "- Do not invent facts or follow-ups that are not supported by the note.",
          "- Never output placeholders without content.",
          "- If a section has nothing useful, write '- None.'",
          "- Rewrite spoken language into clean written language.",
        ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `Title: ${record.title}`,
        `Type: ${getFlowConfig(record.type).label}`,
        "",
        record.type === "meeting"
          ? "Task: Produce meeting notes that capture what happened, what was decided, what still needs action, and what remains unresolved."
          : "Task: Produce a clear summary of the voice note and any concrete follow-up.",
        "",
        "Context and manual notes:",
        record.manualNotes || "None provided",
        "",
        "Transcript:",
        record.transcript || "None provided",
      ].join("\n"),
    },
  ];
}

export function buildRepairMessages(record, brokenDraft) {
  const sectionList =
    record.type === "meeting"
      ? "## Summary\n## Decisions\n## Action Items\n## Risks\n## Open Questions\n## Next Steps"
      : "## Summary\n## Key Points\n## Follow-Up";

  return [
    {
      role: "system",
      content: [
        "Rewrite the provided markdown into clean final notes.",
        "Return markdown only.",
        "Keep the same factual meaning, but fix structure.",
        "Do not invent facts or add new content.",
        "Rules:",
        "- No nested bullets.",
        "- No repeated placeholder bullets.",
        "- Each bullet must contain content.",
        "- Use exactly these headings:",
        sectionList,
      ].join("\n"),
    },
    {
      role: "user",
      content: ["Rewrite this broken draft:", brokenDraft || "No draft provided."].join("\n\n"),
    },
  ];
}

export function buildRewriteMessages(record, draft, presetKey) {
  const preset = REWRITE_PRESETS[presetKey] ?? REWRITE_PRESETS.professional;
  const sectionList =
    record.type === "meeting"
      ? "## Summary\n## Decisions\n## Action Items\n## Risks\n## Open Questions\n## Next Steps"
      : "## Summary\n## Key Points\n## Follow-Up";

  const sourceDraft = String(draft || "").trim();
  const transcript = record.transcript?.trim() || "None provided.";
  const manualNotes = record.manualNotes?.trim() || "None provided.";

  return [
    {
      role: "system",
      content: [
        "Rewrite the provided notes into a clean final draft.",
        "Return markdown only.",
        preset.instruction,
        "Do not invent facts, names, dates, or action items.",
        "Preserve the factual meaning.",
        "Use exactly these headings:",
        sectionList,
        "Rules:",
        "- No nested bullets.",
        "- Use flat bullets only.",
        "- Every bullet must contain concrete content.",
        "- Remove placeholders and repeated fragments.",
        "- If a section has nothing useful, write '- None.'",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Title: ${record.title}`,
        `Type: ${getFlowConfig(record.type).label}`,
        "",
        "Current notes draft:",
        sourceDraft || "No draft yet.",
        "",
        "Context and manual notes:",
        manualNotes,
        "",
        "Transcript:",
        transcript,
      ].join("\n"),
    },
  ];
}

export function buildTitleMessages(record) {
  const transcript = record.transcript?.trim() || "None provided.";
  const manualNotes = record.manualNotes?.trim() || "None provided.";
  const currentNotes = record.meetingNotes?.trim() || "None provided.";

  return [
    {
      role: "system",
      content: [
        "Write a concise, professional title for the provided notes.",
        "Return plain text only.",
        "Do not use markdown, quotes, labels, or multiple options.",
        "Keep it under 8 words.",
        "Use title case.",
        "Be specific and factual.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Current title: ${record.title}`,
        `Type: ${getFlowConfig(record.type).label}`,
        "",
        "Transcript:",
        transcript,
        "",
        "Context and manual notes:",
        manualNotes,
        "",
        "Current notes:",
        currentNotes,
      ].join("\n"),
    },
  ];
}

export function sanitizeGeneratedTitle(text, fallbackTitle) {
  const raw = String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/^["'`#*\-\s]+|["'`#*\-\s]+$/g, "")
    .replace(/^(title|summary|meeting|voice note)\s*:\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!raw) {
    return fallbackTitle;
  }

  const words = raw.split(/\s+/).slice(0, 8);
  const compact = words.join(" ").replace(/[.:;,\-–—]+$/g, "").trim();
  return compact || fallbackTitle;
}

export function sanitizeGeneratedNotes(text, type) {
  return normalizeGeneratedNotes(removeRunawayRepetition(text), type);
}

export function normalizeGeneratedNotes(text, type) {
  const sectionFallback =
    type === "meeting"
      ? ["## Summary", "## Decisions", "## Action Items", "## Risks", "## Open Questions", "## Next Steps"]
      : ["## Summary", "## Key Points", "## Follow-Up"];

  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").trimEnd());

  const cleaned = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (cleaned.at(-1) !== "") {
        cleaned.push("");
      }
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      cleaned.push(trimmed.replace(/^#{1,3}\s*/, "## "));
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const bulletText = trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
      if (!isPlaceholderBullet(bulletText)) {
        cleaned.push(`- ${bulletText}`);
      }
      continue;
    }

    if (!isPlaceholderBullet(trimmed)) {
      cleaned.push(trimmed);
    }
  }

  const compact = cleaned.filter((line, index) => !(line === "" && cleaned[index - 1] === ""));
  const joined = compact.join("\n").trim();

  if (sectionFallback.every((heading) => !joined.includes(heading))) {
    return `${sectionFallback.join("\n\n")}\n\n- ${joined || "None."}`;
  }

  return joined;
}

export function needsNotesRepair(text) {
  const value = String(text || "");
  const placeholderMatches =
    value.match(/(^|\n)-\s*(action|action item|decision|summary|risk|follow-up|next step|open question)s?:?\s*$/gim) || [];
  const nestedMatches = value.match(/^\s{2,}[-*]\s+/gm) || [];
  const emptySections = value.match(/^## .+\n(?=\n## |\s*$)/gm) || [];
  const repeatedWordLoops = countRepeatedWordLoops(value);
  const repeatedPhraseLoops = countRepeatedPhraseLoops(value);

  return (
    placeholderMatches.length >= 2 ||
    nestedMatches.length >= 2 ||
    emptySections.length >= 2 ||
    repeatedWordLoops >= 3 ||
    repeatedPhraseLoops >= 2
  );
}

function isPlaceholderBullet(text) {
  return /^(action|action item|decision|summary|risk|follow-up|next step|open question|key point)s?:?\s*$/i.test(text);
}

function removeRunawayRepetition(text) {
  let value = String(text || "").replace(/\r/g, " ");

  value = value.replace(/\b([a-z]{2,})\b(?:\s+\1\b){2,}/gi, "$1");
  value = value.replace(/(\b[\w/.-]+\b(?:\s+\b[\w/.-]+\b){1,5})(?:\s+\1\b){2,}/gi, "$1");
  value = value.replace(/([/,-])(?:\s*\1){2,}/g, "$1");
  value = value.replace(/\s{2,}/g, " ");
  value = value.replace(/\n{3,}/g, "\n\n");

  return value.trim();
}

function countRepeatedWordLoops(text) {
  const matches = String(text || "").match(/\b([a-z]{2,})\b(?:\s+\1\b){2,}/gi) || [];
  return matches.length;
}

function countRepeatedPhraseLoops(text) {
  const matches =
    String(text || "").match(/(\b[\w/.-]+\b(?:\s+\b[\w/.-]+\b){1,5})(?:\s+\1\b){2,}/gi) || [];
  return matches.length;
}
