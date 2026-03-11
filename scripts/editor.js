const SITE_STORAGE_KEY = "siteStylesByHost";
const GLOBAL_LAYOUT_KEY = "bssGlobalLayout";

const BUILTIN_SECTION_DEFS = [
  { id: "backgrounds", defaultLabel: "Background Settings", note: "Put only background-related CSS here.", helpKey: "backgrounds" },
  { id: "fonts", defaultLabel: "Font Settings", note: "Put only font-related CSS here.", helpKey: "fonts" },
  { id: "fontColors", defaultLabel: "Font Color Settings", note: "Put text color CSS here.", helpKey: "fontColors" },
  { id: "sizes", defaultLabel: "Sizes / Spacing", note: "Put width / height / margin / padding CSS here.", helpKey: "sizes" },
  { id: "images", defaultLabel: "Image Settings", note: "Put image-related CSS here.", helpKey: "images" },
  { id: "icons", defaultLabel: "New Icons", note: "Put icon-related CSS here.", helpKey: "icons" },
  { id: "cssMisc", defaultLabel: "Misc CSS", note: "Put miscellaneous CSS here.", helpKey: "cssMisc" }
];

const BUILTIN_IDS = new Set(BUILTIN_SECTION_DEFS.map(section => section.id));

const SECTION_META = {
  siteSettings: {
    title: "1: Site Settings",
    desc: "Match this site and control general behavior.",
    panel: "siteSettings",
    helpKey: "siteSettings"
  },
  textRules: {
    title: "3: Text Match Rules",
    desc: "Rules that match inner text using selector + regex + CSS declarations.",
    panel: "textRules",
    helpKey: "textRules"
  },
  notes: {
    title: "4: Notes",
    desc: "Site-wide notes now live in Site Settings.",
    panel: "notes",
    helpKey: "notes"
  }
};

const HELP_CONTENT = {
  siteSettings: `<h3>Site Settings</h3><p>This section is for general site controls and site-wide notes.</p>`,
  backgrounds: `<h3>Background Settings</h3><pre>body {\n  background: #050505 !important;\n}</pre>`,
  fonts: `<h3>Font Settings</h3><pre>body {\n  font-size: 18px !important;\n}</pre>`,
  fontColors: `<h3>Font Color Settings</h3><pre>a {\n  color: #07beff !important;\n}</pre>`,
  sizes: `<h3>Sizes / Spacing</h3><pre>.box {\n  padding: 18px !important;\n}</pre>`,
  images: `<h3>Image Settings</h3><pre>img {\n  border-radius: 10px !important;\n}</pre>`,
  icons: `<h3>New Icons</h3><pre>.status-ok::before {\n  content: "✔ ";\n  color: #00b050 !important;\n}</pre>`,
  cssMisc: `<h3>Misc CSS</h3><pre>.my-rule {\n  outline: 1px solid #ff8c00 !important;\n}</pre>`,
  customCss: `<h3>Custom CSS Section</h3><p>This is your own custom CSS bucket.</p>`,
  textRules: `<h3>Text Match Rules</h3><pre>b | ,\\\\s\\\\d{4}$ | color:#07beff !important;</pre>`,
  notes: `<h3>Site-wide Notes</h3><p>General notes now live inside 1: Site Settings. Section-specific notes are on the Notes button beside Autocomplete.</p>`
};

const HEX_REGEX_GLOBAL = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

const els = {
  hostPill: document.getElementById("hostPill"),
  enabledToggle: document.getElementById("enabledToggle"),
  livePreviewToggle: document.getElementById("livePreviewToggle"),
  autoApplyToggle: document.getElementById("autoApplyToggle"),
  saveLayoutBtn: document.getElementById("saveLayoutBtn"),
  saveSiteBtn: document.getElementById("saveSiteBtn"),
  applyBtn: document.getElementById("applyBtn"),
  clearBtn: document.getElementById("clearBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  manageSectionsBtn: document.getElementById("manageSectionsBtn"),

  helpBtn: document.getElementById("helpBtn"),
  closeHelpBtn: document.getElementById("closeHelpBtn"),
  helpModal: document.getElementById("helpModal"),
  helpContent: document.getElementById("helpContent"),

  manageSectionsModal: document.getElementById("manageSectionsModal"),
  closeManageSectionsBtn: document.getElementById("closeManageSectionsBtn"),
  addSectionBtn: document.getElementById("addSectionBtn"),
  sectionsManagerList: document.getElementById("sectionsManagerList"),

  sectionNotesBtn: document.getElementById("sectionNotesBtn"),
  sectionNotesModal: document.getElementById("sectionNotesModal"),
  closeSectionNotesBtn: document.getElementById("closeSectionNotesBtn"),
  sectionNotesTitle: document.getElementById("sectionNotesTitle"),
  sectionNotesInput: document.getElementById("sectionNotesInput"),
  saveSectionNotesBtn: document.getElementById("saveSectionNotesBtn"),

  pickElementBtn: document.getElementById("pickElementBtn"),

  status: document.getElementById("status"),
  sectionTitle: document.getElementById("sectionTitle"),
  sectionDesc: document.getElementById("sectionDesc"),
  sectionNav: document.getElementById("sectionNav"),

  hostnameInput: document.getElementById("hostnameInput"),
  urlInput: document.getElementById("urlInput"),
  siteSummary: document.getElementById("siteSummary"),
  notesInput: document.getElementById("notesInput"),

  codeEditorMount: document.getElementById("codeEditorMount"),
  textRulesEditorMount: document.getElementById("textRulesEditorMount"),

  sortSelectionBtn: document.getElementById("sortSelectionBtn"),
  autocompleteBtn: document.getElementById("autocompleteBtn"),
  sortTextRulesBtn: document.getElementById("sortTextRulesBtn"),

  sectionPanels: Array.from(document.querySelectorAll(".editor-section"))
};

let currentHost = "";
let linkedTabId = null;
let currentSection = "siteSettings";
let cssGroupExpanded = true;
let draggedSectionId = null;
let dirtyLayout = false;
let dirtySite = false;
let autoApplyTimer = null;
let livePreviewTimer = null;
let isAutoApplying = false;
let activeEditorKind = "code";
let isPickingElement = false;

let codeEditor = null;
let textRulesEditor = null;
let colorMarks = [];

const globalLayout = { sections: [] };
const siteData = {
  enabled: true,
  livePreview: true,
  autoApply: false,
  siteSummary: "",
  cssBySection: {},
  sectionNotes: {},
  textRules: "",
  notes: ""
};

function setStatus(message) {
  els.status.textContent = message;
}

function markLayoutDirty() {
  dirtyLayout = true;
  if (!isAutoApplying) setStatus("Layout changed. Click Save Layout.");
}

function markSiteDirty() {
  dirtySite = true;
  if (!isAutoApplying) setStatus("Site changed. Click Save This Site.");
}

function clearDirtyFlagsAfterLoad() {
  dirtyLayout = false;
  dirtySite = false;
}

function getQueryParams() {
  const params = new URLSearchParams(location.search);
  return {
    host: params.get("host") || "",
    tabId: params.get("tabId") || ""
  };
}

async function getTabById(tabId) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.get(Number(tabId));
  } catch {
    return null;
  }
}

async function findBestCurrentTab(host) {
  const tabs = await chrome.tabs.query({});
  return tabs.find(tab => {
    try {
      return new URL(tab.url).hostname === host;
    } catch {
      return false;
    }
  }) || null;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sanitizeLegacyCorruption(text) {
  if (!text) return "";
  return String(text)
    .replace(/"?tok-(selector|prop|value|brace|comment|atrule|string|number|regex)"?>/g, "")
    .replace(/<\/span>/g, "")
    .replace(/<span class="[^"]+">/g, "");
}

function makeDefaultLayoutSections() {
  return BUILTIN_SECTION_DEFS.map(def => ({
    id: def.id,
    label: def.defaultLabel,
    type: "builtin"
  }));
}

function normalizeLayoutSections(rawSections) {
  const incoming = Array.isArray(rawSections) ? rawSections : [];
  const cleaned = incoming
    .map(section => ({
      id: String(section?.id || "").trim(),
      label: String(section?.label || "").trim(),
      type: section?.type === "custom" ? "custom" : "builtin"
    }))
    .filter(section => section.id);

  const seen = new Set();
  const result = [];

  for (const section of cleaned) {
    if (seen.has(section.id)) continue;

    if (BUILTIN_IDS.has(section.id)) {
      const def = BUILTIN_SECTION_DEFS.find(item => item.id === section.id);
      result.push({
        id: section.id,
        label: section.label || def.defaultLabel,
        type: "builtin"
      });
      seen.add(section.id);
    } else if (section.type === "custom") {
      result.push({
        id: section.id,
        label: section.label || "Custom Section",
        type: "custom"
      });
      seen.add(section.id);
    }
  }

  for (const def of BUILTIN_SECTION_DEFS) {
    if (!seen.has(def.id)) {
      result.push({
        id: def.id,
        label: def.defaultLabel,
        type: "builtin"
      });
    }
  }

  return result;
}

function normalizeLayoutRecord(globalStored, firstSiteRecord = null) {
  if (globalStored && Array.isArray(globalStored.sections)) {
    return { sections: normalizeLayoutSections(globalStored.sections) };
  }

  if (firstSiteRecord && Array.isArray(firstSiteRecord.sections)) {
    return { sections: normalizeLayoutSections(firstSiteRecord.sections) };
  }

  return { sections: makeDefaultLayoutSections() };
}

function normalizeSiteRecord(storedSite) {
  const record = storedSite || {};
  const cssBySection = {};
  const sectionNotes = {};

  if (record.cssBySection && typeof record.cssBySection === "object") {
    for (const [key, value] of Object.entries(record.cssBySection)) {
      cssBySection[key] = sanitizeLegacyCorruption(value || "");
    }
  } else if (Array.isArray(record.sections)) {
    for (const section of record.sections) {
      if (section?.id) {
        cssBySection[String(section.id)] = sanitizeLegacyCorruption(section.css || "");
      }
    }
  } else {
    cssBySection.backgrounds = sanitizeLegacyCorruption(record.backgrounds || "");
    cssBySection.fonts = sanitizeLegacyCorruption(record.fonts || "");
    cssBySection.fontColors = sanitizeLegacyCorruption(record.fontColors || "");
    cssBySection.sizes = sanitizeLegacyCorruption(record.sizes || "");
    cssBySection.images = sanitizeLegacyCorruption(record.images || "");
    cssBySection.icons = sanitizeLegacyCorruption(record.icons || "");
    cssBySection.cssMisc = sanitizeLegacyCorruption(record.cssMisc || "");
  }

  if (record.sectionNotes && typeof record.sectionNotes === "object") {
    for (const [key, value] of Object.entries(record.sectionNotes)) {
      sectionNotes[key] = value || "";
    }
  }

  return {
    enabled: record.enabled !== false,
    livePreview: record.livePreview !== false,
    autoApply: record.autoApply === true,
    siteSummary: record.siteSummary || "",
    cssBySection,
    sectionNotes,
    textRules: sanitizeLegacyCorruption(record.textRules || ""),
    notes: record.notes || ""
  };
}

function getSectionById(sectionId) {
  return globalLayout.sections.find(section => section.id === sectionId) || null;
}

function getSectionNote(sectionId) {
  const builtin = BUILTIN_SECTION_DEFS.find(section => section.id === sectionId);
  if (builtin) return builtin.note;
  return "Put CSS for this custom section here.";
}

function getHelpKeyForCurrentSection() {
  if (SECTION_META[currentSection]?.helpKey) return SECTION_META[currentSection].helpKey;
  const section = getSectionById(currentSection);
  if (!section) return "siteSettings";
  return section.type === "custom" ? "customCss" : section.id;
}

function sectionHasNotes(sectionId) {
  return !!String(siteData.sectionNotes?.[sectionId] || "").trim();
}

function buildSidebar() {
  const cssChildren = globalLayout.sections.map(section => {
    const activeClass = currentSection === section.id ? " active" : "";
    const noteDot = sectionHasNotes(section.id)
      ? `<span class="section-note-dot" title="Has notes"></span>`
      : "";

    return `
      <button class="section-btn sub-btn${activeClass}" data-section="${escapeHtml(section.id)}">
        <span class="section-label-line">
          <span>${escapeHtml(section.label)}</span>
          ${noteDot}
        </span>
      </button>
    `;
  }).join("");

  els.sectionNav.innerHTML = `
    <button class="section-btn${currentSection === "siteSettings" ? " active" : ""}" data-section="siteSettings">
      1: Site Settings
    </button>

    <button class="section-btn section-parent" id="cssGroupBtn" aria-expanded="${cssGroupExpanded ? "true" : "false"}">
      <span>2: CSS Sections</span>
      <span class="chev">${cssGroupExpanded ? "▾" : "▸"}</span>
    </button>

    <div class="subsection-list${cssGroupExpanded ? "" : " collapsed"}" id="cssGroup">
      ${cssChildren}
    </div>

    <button class="section-btn${currentSection === "textRules" ? " active" : ""}" data-section="textRules">
      3: Text Match Rules
    </button>

    <button class="section-btn${currentSection === "notes" ? " active" : ""}" data-section="notes">
      4: Notes
    </button>
  `;

  els.sectionNav.querySelectorAll(".section-btn[data-section]").forEach(btn => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });

  const cssGroupBtn = document.getElementById("cssGroupBtn");
  if (cssGroupBtn) {
    cssGroupBtn.addEventListener("click", () => {
      cssGroupExpanded = !cssGroupExpanded;
      buildSidebar();
    });
  }
}

function moveSectionToIndex(sectionId, targetIndex) {
  const fromIndex = globalLayout.sections.findIndex(section => section.id === sectionId);
  if (fromIndex === -1 || targetIndex < 0 || targetIndex >= globalLayout.sections.length) return;
  if (fromIndex === targetIndex) return;

  const [moved] = globalLayout.sections.splice(fromIndex, 1);
  globalLayout.sections.splice(targetIndex, 0, moved);
}

function renderSectionsManager() {
  els.sectionsManagerList.innerHTML = globalLayout.sections.map(section => {
    const isBuiltin = section.type === "builtin";
    const badge = isBuiltin
      ? `<span class="lock-badge">Protected</span>`
      : `<span class="custom-badge">Custom</span>`;

    return `
      <div class="manager-row" data-manager-id="${escapeHtml(section.id)}">
        <button
          class="drag-handle"
          data-role="drag-handle"
          data-section-id="${escapeHtml(section.id)}"
          draggable="true"
          title="Drag to reorder"
        >⋮⋮</button>

        <input
          class="manager-label-input"
          type="text"
          value="${escapeHtml(section.label)}"
          data-role="label-input"
          data-section-id="${escapeHtml(section.id)}"
        >

        ${badge}

        <div class="manager-row-actions">
          <button class="manager-icon-btn ${isBuiltin ? "is-disabled" : ""}" data-role="delete" data-section-id="${escapeHtml(section.id)}" ${isBuiltin ? "disabled" : ""}>✕</button>
        </div>
      </div>
    `;
  }).join("");

  els.sectionsManagerList.querySelectorAll('[data-role="label-input"]').forEach(input => {
    input.addEventListener("input", () => {
      const section = getSectionById(input.dataset.sectionId);
      if (!section) return;

      section.label = input.value.trim() || getFallbackLabel(section.id);
      buildSidebar();

      if (currentSection === section.id) {
        updateCodeEditorFromSection();
        updateHeaderForSection(section.id);
      }

      markLayoutDirty();
      scheduleAutoApply();
      scheduleLivePreview();
    });
  });

  els.sectionsManagerList.querySelectorAll('[data-role="delete"]').forEach(btn => {
    btn.addEventListener("click", () => deleteSection(btn.dataset.sectionId));
  });

  els.sectionsManagerList.querySelectorAll(".manager-row").forEach(row => {
    const sectionId = row.dataset.managerId;
    const handle = row.querySelector('[data-role="drag-handle"]');

    handle.addEventListener("dragstart", e => {
      draggedSectionId = sectionId;
      row.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sectionId);
    });

    handle.addEventListener("dragend", () => {
      draggedSectionId = null;
      clearManagerDragClasses();
    });

    row.addEventListener("dragover", e => {
      if (!draggedSectionId || draggedSectionId === sectionId) return;
      e.preventDefault();
      row.classList.add("is-drop-target");
      e.dataTransfer.dropEffect = "move";
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drop-target");
    });

    row.addEventListener("drop", e => {
      if (!draggedSectionId || draggedSectionId === sectionId) return;
      e.preventDefault();

      const targetIndex = globalLayout.sections.findIndex(section => section.id === sectionId);
      moveSectionToIndex(draggedSectionId, targetIndex);

      clearManagerDragClasses();
      buildSidebar();
      renderSectionsManager();
      markLayoutDirty();
      scheduleAutoApply();
      scheduleLivePreview();
    });
  });
}

function clearManagerDragClasses() {
  els.sectionsManagerList.querySelectorAll(".manager-row").forEach(row => {
    row.classList.remove("is-dragging", "is-drop-target");
  });
}

function getFallbackLabel(sectionId) {
  const builtin = BUILTIN_SECTION_DEFS.find(section => section.id === sectionId);
  if (builtin) return builtin.defaultLabel;
  return "Custom Section";
}

function addCustomSection() {
  syncCurrentCodeIntoSiteData();

  const id = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const label = `Custom Section ${globalLayout.sections.filter(section => section.type === "custom").length + 1}`;

  globalLayout.sections.push({ id, label, type: "custom" });

  if (!(id in siteData.cssBySection)) {
    siteData.cssBySection[id] = "";
  }

  if (!(id in siteData.sectionNotes)) {
    siteData.sectionNotes[id] = "";
  }

  buildSidebar();
  renderSectionsManager();
  switchSection(id);
  markLayoutDirty();
  markSiteDirty();
  scheduleAutoApply();
  scheduleLivePreview();
}

function deleteSection(sectionId) {
  const section = getSectionById(sectionId);
  if (!section || section.type !== "custom") return;

  const index = globalLayout.sections.findIndex(item => item.id === sectionId);
  if (index === -1) return;

  globalLayout.sections.splice(index, 1);
  delete siteData.cssBySection[sectionId];
  delete siteData.sectionNotes[sectionId];

  if (currentSection === sectionId) {
    currentSection = globalLayout.sections[0]?.id || "siteSettings";
  }

  buildSidebar();
  renderSectionsManager();
  switchSection(currentSection);
  markLayoutDirty();
  markSiteDirty();
  scheduleAutoApply();
  scheduleLivePreview();
}

function normalizeHexForPicker(hex) {
  const raw = hex.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return "#" + raw.slice(1).split("").map(ch => ch + ch).join("");
  }
  if (/^#[0-9a-fA-F]{4}$/.test(raw)) {
    return "#" + raw.slice(1, 4).split("").map(ch => ch + ch).join("");
  }
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{8}$/.test(raw)) return raw.slice(0, 7);
  return "#000000";
}

function clearColorMarks() {
  colorMarks.forEach(mark => {
    try {
      mark.clear();
    } catch {}
  });
  colorMarks = [];
}

function renderColorSwatches() {
  clearColorMarks();

  if (!codeEditor) return;
  if (!getSectionById(currentSection)) return;

  const doc = codeEditor.getDoc();
  const text = doc.getValue();

  HEX_REGEX_GLOBAL.lastIndex = 0;
  let match;

  while ((match = HEX_REGEX_GLOBAL.exec(text)) !== null) {
    const hex = match[0];
    const startIndex = match.index;
    const endIndex = startIndex + hex.length;

    const to = doc.posFromIndex(endIndex);

    const wrapper = document.createElement("span");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.marginLeft = "4px";
    wrapper.style.verticalAlign = "middle";

    const swatch = document.createElement("span");
    swatch.className = "cm-hex-swatch";
    swatch.style.background = normalizeHexForPicker(hex);
    swatch.title = `Pick color for ${hex}`;

    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "cm-color-input";
    picker.value = normalizeHexForPicker(hex);

    swatch.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
    });

    swatch.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();

      try {
        picker.focus({ preventScroll: true });
      } catch {}

      if (typeof picker.showPicker === "function") {
        try {
          picker.showPicker();
          return;
        } catch {}
      }

      picker.click();
    });

    picker.addEventListener("input", () => {
      const latestDoc = codeEditor.getDoc();
      const latestText = latestDoc.getValue();

      const latestRegex = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
      let latestMatch;
      let foundStart = -1;
      let foundEnd = -1;

      while ((latestMatch = latestRegex.exec(latestText)) !== null) {
        if (latestMatch.index === startIndex) {
          foundStart = latestMatch.index;
          foundEnd = latestMatch.index + latestMatch[0].length;
          break;
        }
      }

      if (foundStart === -1) return;

      const latestFrom = latestDoc.posFromIndex(foundStart);
      const latestTo = latestDoc.posFromIndex(foundEnd);

      latestDoc.replaceRange(picker.value, latestFrom, latestTo);

      setTimeout(() => {
        syncCurrentCodeIntoSiteData();
        renderColorSwatches();
      }, 0);
    });

    wrapper.appendChild(swatch);
    wrapper.appendChild(picker);

    const bookmark = doc.setBookmark(to, {
      widget: wrapper,
      insertLeft: false
    });

    colorMarks.push(bookmark);
  }
}

function initEditors() {
  if (typeof CodeMirror === "undefined") {
    throw new Error("CodeMirror is not loaded");
  }

  codeEditor = CodeMirror(els.codeEditorMount, {
    value: "",
    mode: "css",
    lineNumbers: true,
    lineWrapping: true,
    theme: "default",
    extraKeys: {
      "Ctrl-Space": cm => cm.showHint({ completeSingle: false }),
      F9: () => sortSelectionInFocusedEditor(),
      Tab: cm => {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
        } else {
          cm.replaceSelection("  ", "end");
        }
      }
    }
  });

  textRulesEditor = CodeMirror(els.textRulesEditorMount, {
    value: "",
    mode: "text/plain",
    lineNumbers: true,
    lineWrapping: true,
    theme: "default",
    extraKeys: {
      F9: () => sortSelectionInFocusedEditor(),
      Tab: cm => cm.replaceSelection("  ", "end")
    }
  });

  codeEditor.on("focus", () => {
    activeEditorKind = "code";
    setTimeout(() => {
      renderColorSwatches();
    }, 0);
  });

  codeEditor.on("cursorActivity", () => {
    activeEditorKind = "code";
  });

  codeEditor.on("change", () => {
    if (!getSectionById(currentSection)) return;
    syncCurrentCodeIntoSiteData();

    setTimeout(() => {
      renderColorSwatches();
    }, 0);

    markSiteDirty();
    scheduleAutoApply();
    scheduleLivePreview();
  });

  codeEditor.on("viewportChange", () => {
    setTimeout(() => {
      renderColorSwatches();
    }, 0);
  });

  codeEditor.on("refresh", () => {
    setTimeout(() => {
      renderColorSwatches();
    }, 0);
  });

  codeEditor.on("inputRead", (cm, change) => {
    if (!change.text || !change.text[0]) return;
    const ch = change.text[0];
    if (/^[a-zA-Z-]$/.test(ch)) {
      cm.showHint({ completeSingle: false });
    }
  });

  textRulesEditor.on("focus", () => {
    activeEditorKind = "textRules";
  });

  textRulesEditor.on("cursorActivity", () => {
    activeEditorKind = "textRules";
  });

  textRulesEditor.on("change", () => {
    siteData.textRules = textRulesEditor.getValue();
    markSiteDirty();
    scheduleAutoApply();
    scheduleLivePreview();
  });
}

function syncCurrentCodeIntoSiteData() {
  const section = getSectionById(currentSection);
  if (!section || !codeEditor) return;
  siteData.cssBySection[section.id] = codeEditor.getValue();
}

function getFocusedEditor() {
  if (activeEditorKind === "textRules") return textRulesEditor;
  return codeEditor;
}

function getSelectorSortBucket(line) {
  const trimmed = line.trim();

  if (!trimmed) return 99;
  if (trimmed.startsWith("#")) return 1;
  if (trimmed.startsWith(".")) return 2;
  if (trimmed.startsWith("[")) return 3;

  return 4;
}

function sortCssSelection(selection) {
  const lines = selection.split("\n");

  const sortable = lines.map((line, index) => ({
    line,
    index,
    trimmed: line.trim(),
    bucket: getSelectorSortBucket(line)
  }));

  sortable.sort((a, b) => {
    if (!a.trimmed && !b.trimmed) return a.index - b.index;
    if (!a.trimmed) return 1;
    if (!b.trimmed) return -1;

    if (a.bucket !== b.bucket) return a.bucket - b.bucket;

    return a.trimmed.localeCompare(b.trimmed, undefined, {
      sensitivity: "base"
    });
  });

  return sortable.map(item => item.line).join("\n");
}

function sortSelectionInEditor(cm) {
  if (!cm) return;

  const doc = cm.getDoc();
  const selection = doc.getSelection();

  if (!selection) {
    setStatus("Highlight something first, then press F9.");
    return;
  }

  const sorted = sortCssSelection(selection);
  doc.replaceSelection(sorted, "around");

  if (cm === codeEditor) {
    syncCurrentCodeIntoSiteData();
    renderColorSwatches();
  } else if (cm === textRulesEditor) {
    siteData.textRules = textRulesEditor.getValue();
  }

  markSiteDirty();
  scheduleAutoApply();
  scheduleLivePreview();
  setStatus("Selection sorted by CSS type.");
}

function sortSelectionInFocusedEditor() {
  sortSelectionInEditor(getFocusedEditor());
}

function updateHeaderForSection(sectionId) {
  if (SECTION_META[sectionId]) {
    els.sectionTitle.textContent = SECTION_META[sectionId].title;
    els.sectionDesc.textContent = SECTION_META[sectionId].desc;
    return;
  }

  const section = getSectionById(sectionId);
  if (!section) return;

  els.sectionTitle.textContent = `2: ${section.label}`;
  els.sectionDesc.textContent = getSectionNote(section.id);
}

function updateCodeEditorFromSection() {
  const section = getSectionById(currentSection);
  if (!section || !codeEditor) return;

  codeEditor.operation(() => {
    codeEditor.setValue(siteData.cssBySection[section.id] || "");
  });

  setTimeout(() => {
    renderColorSwatches();
  }, 0);
}

function collectGlobalLayoutRecord() {
  return {
    version: 1,
    sections: globalLayout.sections.map(section => ({
      id: section.id,
      label: section.label,
      type: section.type
    }))
  };
}

function collectSiteRecord() {
  syncCurrentCodeIntoSiteData();

  siteData.enabled = els.enabledToggle.checked;
  siteData.livePreview = els.livePreviewToggle.checked;
  siteData.autoApply = els.autoApplyToggle.checked;
  siteData.siteSummary = els.siteSummary.value;
  siteData.textRules = textRulesEditor ? textRulesEditor.getValue() : siteData.textRules;
  siteData.notes = els.notesInput.value;

  const cssBySection = {};
  const sectionNotes = {};

  for (const section of globalLayout.sections) {
    cssBySection[section.id] = siteData.cssBySection[section.id] || "";
    sectionNotes[section.id] = siteData.sectionNotes[section.id] || "";
  }

  return {
    enabled: siteData.enabled,
    livePreview: siteData.livePreview,
    autoApply: siteData.autoApply,
    siteSummary: siteData.siteSummary,
    cssBySection,
    sectionNotes,
    textRules: siteData.textRules,
    notes: siteData.notes,
    updatedAt: Date.now()
  };
}

function buildPreviewCssFromCurrentState() {
  syncCurrentCodeIntoSiteData();

  const parts = [];

  for (const section of globalLayout.sections) {
    const css = siteData.cssBySection[section.id] || "";
    if (css.trim()) {
      parts.push(`/* ${section.label || section.id} */\n${css}`);
    }
  }

  return parts.join("\n\n");
}

function buildPreviewPayload() {
  siteData.enabled = els.enabledToggle.checked;
  siteData.livePreview = els.livePreviewToggle.checked;
  siteData.autoApply = els.autoApplyToggle.checked;
  siteData.siteSummary = els.siteSummary.value;
  siteData.textRules = textRulesEditor ? textRulesEditor.getValue() : siteData.textRules;
  siteData.notes = els.notesInput.value;

  if (!siteData.enabled || !siteData.livePreview) {
    return {
      css: "",
      textRules: ""
    };
  }

  return {
    css: buildPreviewCssFromCurrentState(),
    textRules: siteData.textRules || ""
  };
}

async function resolveLinkedTab() {
  if (linkedTabId) {
    try {
      const tab = await chrome.tabs.get(Number(linkedTabId));
      if (tab?.id) {
        return tab;
      }
    } catch (err) {
      console.warn("BSS linked tab lookup failed:", err);
    }
  }

  if (currentHost) {
    const byHost = await findBestCurrentTab(currentHost);
    if (byHost?.id) {
      linkedTabId = byHost.id;
      return byHost;
    }
  }

  return null;
}

async function sendMessageToLinkedTab(message) {
  const tab = await resolveLinkedTab();
  if (!tab?.id) {
    console.warn("BSS no linked site tab found for message:", message?.type);
    return null;
  }

  linkedTabId = tab.id;

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    console.warn("BSS sendMessage failed:", err);
    return null;
  }
}

async function clearPreviewOnPage(showStatus = false) {
  const response = await sendMessageToLinkedTab({ type: "BSS_CLEAR_PREVIEW" });

  if (showStatus) {
    if (response?.ok) setStatus("Live preview cleared.");
    else setStatus("Could not clear preview on page.");
  }
}

async function pushLivePreviewNow(showStatus = false) {
  const payload = buildPreviewPayload();

  if (!siteData.enabled || !siteData.livePreview) {
    await clearPreviewOnPage(showStatus);
    return;
  }

  const response = await sendMessageToLinkedTab({
    type: "BSS_SET_PREVIEW",
    css: payload.css,
    textRules: payload.textRules
  });

  if (showStatus) {
    if (response?.ok) setStatus("Live preview updated.");
    else setStatus("Preview could not reach the site tab.");
  }
}

function scheduleLivePreview() {
  clearTimeout(livePreviewTimer);

  if (!els.livePreviewToggle.checked) return;
  if (!els.enabledToggle.checked) return;
  if (!linkedTabId) return;

  livePreviewTimer = setTimeout(() => {
    void pushLivePreviewNow(true);
  }, 200);
}

function insertSelectorIntoEditor(selector) {
  if (!selector || !codeEditor) return;

  const section = getSectionById(currentSection);
  if (!section) return;

  const doc = codeEditor.getDoc();
  const currentValue = doc.getValue();
  const block = `${selector} {\n  \n}\n`;

  if (!currentValue.trim()) {
    doc.setValue(block);
  } else {
    const needsGap = currentValue.endsWith("\n\n") ? "" : "\n\n";
    doc.replaceRange(`${needsGap}${block}`, doc.posFromIndex(currentValue.length));
  }

  syncCurrentCodeIntoSiteData();
  markSiteDirty();
  scheduleAutoApply();
  scheduleLivePreview();

  setTimeout(() => {
    codeEditor.focus();
    const updated = codeEditor.getValue();
    const idx = updated.lastIndexOf(`${selector} {`);
    if (idx >= 0) {
      const insidePos = updated.indexOf("  ", idx);
      if (insidePos >= 0) {
        const pos = doc.posFromIndex(insidePos + 2);
        doc.setCursor(pos);
      }
    }
  }, 0);
}

async function startElementPicker() {
  if (isPickingElement) return;

  const section = getSectionById(currentSection);
  if (!section) {
    setStatus("Open a CSS section first.");
    return;
  }

  const response = await sendMessageToLinkedTab({ type: "BSS_START_PICKER" });

  if (response?.ok) {
    isPickingElement = true;
    els.pickElementBtn?.classList.add("is-picking");
    setStatus("Picker on. Hover page, click element, Esc to cancel.");
  } else {
    setStatus("Could not start picker on this tab.");
  }
}

async function stopElementPicker(showStatus = true) {
  await sendMessageToLinkedTab({ type: "BSS_STOP_PICKER" });
  isPickingElement = false;
  els.pickElementBtn?.classList.remove("is-picking");
  if (showStatus) {
    setStatus("Picker off.");
  }
}

async function loadAllData() {
  const result = await chrome.storage.local.get([SITE_STORAGE_KEY, GLOBAL_LAYOUT_KEY]);
  const allSites = result[SITE_STORAGE_KEY] || {};
  const storedSite = allSites[currentHost] || null;
  const storedGlobal = result[GLOBAL_LAYOUT_KEY] || null;

  const normalizedLayout = normalizeLayoutRecord(storedGlobal, storedSite);
  globalLayout.sections = normalizedLayout.sections.map(section => ({ ...section }));

  const normalizedSite = normalizeSiteRecord(storedSite);
  siteData.enabled = normalizedSite.enabled;
  siteData.livePreview = normalizedSite.livePreview;
  siteData.autoApply = normalizedSite.autoApply;
  siteData.siteSummary = normalizedSite.siteSummary;
  siteData.cssBySection = { ...normalizedSite.cssBySection };
  siteData.sectionNotes = { ...normalizedSite.sectionNotes };
  siteData.textRules = normalizedSite.textRules;
  siteData.notes = normalizedSite.notes;

  for (const section of globalLayout.sections) {
    if (!(section.id in siteData.cssBySection)) {
      siteData.cssBySection[section.id] = "";
    }
    if (!(section.id in siteData.sectionNotes)) {
      siteData.sectionNotes[section.id] = "";
    }
  }

  els.enabledToggle.checked = siteData.enabled;
  els.livePreviewToggle.checked = siteData.livePreview;
  els.autoApplyToggle.checked = siteData.autoApply;
  els.siteSummary.value = siteData.siteSummary;
  els.notesInput.value = siteData.notes;

  if (textRulesEditor) {
    textRulesEditor.setValue(siteData.textRules);
  }

  buildSidebar();
  renderSectionsManager();

  if (!SECTION_META[currentSection] && !getSectionById(currentSection)) {
    currentSection = "siteSettings";
  }

  if (getSectionById(currentSection)) {
    updateCodeEditorFromSection();
  }

  clearDirtyFlagsAfterLoad();
  setStatus("Loaded.");

  if (!siteData.enabled || !siteData.livePreview) {
    await clearPreviewOnPage(false);
  }
}

async function saveLayoutData(showStatus = true) {
  const record = collectGlobalLayoutRecord();
  await chrome.storage.local.set({ [GLOBAL_LAYOUT_KEY]: record });
  dirtyLayout = false;
  if (showStatus) setStatus("Layout saved for all sites.");
}

async function saveSiteData(showStatus = true) {
  if (!currentHost) return;

  const result = await chrome.storage.local.get(SITE_STORAGE_KEY);
  const allSites = result[SITE_STORAGE_KEY] || {};
  allSites[currentHost] = collectSiteRecord();

  await chrome.storage.local.set({ [SITE_STORAGE_KEY]: allSites });
  dirtySite = false;

  if (showStatus) setStatus("This site saved.");
}

async function clearSiteData() {
  if (!currentHost) return;

  const result = await chrome.storage.local.get(SITE_STORAGE_KEY);
  const allSites = result[SITE_STORAGE_KEY] || {};
  delete allSites[currentHost];
  await chrome.storage.local.set({ [SITE_STORAGE_KEY]: allSites });

  siteData.enabled = true;
  siteData.livePreview = true;
  siteData.autoApply = false;
  siteData.siteSummary = "";
  siteData.textRules = "";
  siteData.notes = "";
  siteData.cssBySection = {};
  siteData.sectionNotes = {};

  for (const section of globalLayout.sections) {
    siteData.cssBySection[section.id] = "";
    siteData.sectionNotes[section.id] = "";
  }

  els.enabledToggle.checked = true;
  els.livePreviewToggle.checked = true;
  els.autoApplyToggle.checked = false;
  els.siteSummary.value = "";
  els.notesInput.value = "";

  if (textRulesEditor) {
    textRulesEditor.setValue("");
  }

  currentSection = "siteSettings";
  buildSidebar();
  renderSectionsManager();

  if (codeEditor) {
    codeEditor.setValue("");
    renderColorSwatches();
  }

  dirtySite = false;
  setStatus("This site cleared.");

  await clearPreviewOnPage(false);
  await reapplyToPage(false);
}

async function reapplyToPage(showStatus = true) {
  const response = await sendMessageToLinkedTab({ type: "BSS_REAPPLY" });

  if (showStatus) {
    if (response?.ok) setStatus("Applied to page.");
    else setStatus("Apply could not reach the site tab.");
  }
}

async function reloadSiteTab() {
  const tab = await resolveLinkedTab();
  if (!tab?.id) {
    setStatus("No linked tab to reload.");
    return;
  }

  linkedTabId = tab.id;

  try {
    await chrome.tabs.reload(tab.id);
    setStatus("Site tab reloaded.");
  } catch {
    setStatus("Could not reload tab.");
  }
}

async function performAutoApply() {
  if (!els.autoApplyToggle.checked) return;
  if (isAutoApplying) return;

  isAutoApplying = true;

  try {
    if (dirtyLayout) await saveLayoutData(false);
    await saveSiteData(false);
    await clearPreviewOnPage(false);
    await reapplyToPage(false);
    setStatus("Auto applied.");
  } catch (err) {
    console.warn("Auto apply failed:", err);
    setStatus("Auto apply failed.");
  } finally {
    isAutoApplying = false;
  }
}

function scheduleAutoApply() {
  if (!els.autoApplyToggle.checked) return;

  clearTimeout(autoApplyTimer);
  autoApplyTimer = setTimeout(() => {
    void performAutoApply();
  }, 500);
}

function showPanel(panelName) {
  for (const panel of els.sectionPanels) {
    panel.classList.toggle("active", panel.dataset.sectionPanel === panelName);
  }
}

function updateSectionNotesButtonVisibility() {
  const isCssSection = !!getSectionById(currentSection);
  if (els.sectionNotesBtn) {
    els.sectionNotesBtn.style.display = isCssSection ? "" : "none";
  }
  if (els.pickElementBtn) {
    els.pickElementBtn.style.display = isCssSection ? "" : "none";
  }
}

function switchSection(sectionId) {
  syncCurrentCodeIntoSiteData();
  currentSection = sectionId;

  buildSidebar();
  updateHeaderForSection(sectionId);
  updateSectionNotesButtonVisibility();

  if (SECTION_META[sectionId]) {
    showPanel(SECTION_META[sectionId].panel);
    clearColorMarks();
  } else {
    showPanel("codeEditor");
    updateCodeEditorFromSection();
    activeEditorKind = "code";

    setTimeout(() => {
      codeEditor?.refresh();
      renderColorSwatches();
    }, 0);
  }

  if (sectionId === "textRules") {
    activeEditorKind = "textRules";
    clearColorMarks();

    setTimeout(() => {
      textRulesEditor?.refresh();
    }, 0);
  }
}

function openHelp() {
  const helpKey = getHelpKeyForCurrentSection();
  els.helpContent.innerHTML = HELP_CONTENT[helpKey] || `<p>No help available for this section yet.</p>`;
  els.helpModal.classList.remove("hidden");
}

function closeHelp() {
  els.helpModal.classList.add("hidden");
}

function openManageSections() {
  renderSectionsManager();
  els.manageSectionsModal.classList.remove("hidden");
}

function closeManageSections() {
  els.manageSectionsModal.classList.add("hidden");
}

function openSectionNotes() {
  const section = getSectionById(currentSection);
  if (!section) return;

  els.sectionNotesTitle.textContent = `Notes - ${section.label}`;
  els.sectionNotesInput.value = siteData.sectionNotes[section.id] || "";
  els.sectionNotesModal.classList.remove("hidden");
  els.sectionNotesInput.focus();
}

function closeSectionNotes() {
  els.sectionNotesModal.classList.add("hidden");
}

function saveSectionNotes() {
  const section = getSectionById(currentSection);
  if (!section) return;

  siteData.sectionNotes[section.id] = els.sectionNotesInput.value;
  buildSidebar();
  markSiteDirty();
  scheduleAutoApply();
  setStatus(`Saved notes for ${section.label}.`);
  closeSectionNotes();
}

function bindEvents() {
  els.saveLayoutBtn.addEventListener("click", async () => {
    await saveLayoutData(true);
  });

  els.saveSiteBtn.addEventListener("click", async () => {
    await saveSiteData(true);
  });

  els.applyBtn.addEventListener("click", async () => {
    setStatus("Applying...");
    if (dirtyLayout) await saveLayoutData(false);
    await saveSiteData(false);
    await clearPreviewOnPage(false);
    await reapplyToPage(true);
  });

  els.clearBtn.addEventListener("click", clearSiteData);
  els.reloadBtn.addEventListener("click", reloadSiteTab);

  els.enabledToggle.addEventListener("change", async () => {
    siteData.enabled = els.enabledToggle.checked;
    markSiteDirty();
    scheduleLivePreview();

    if (!els.enabledToggle.checked) {
      await clearPreviewOnPage(false);
    }

    if (els.autoApplyToggle.checked) {
      await performAutoApply();
    }
  });

  els.livePreviewToggle.addEventListener("change", async () => {
    siteData.livePreview = els.livePreviewToggle.checked;
    markSiteDirty();

    if (els.livePreviewToggle.checked) {
      scheduleLivePreview();
    } else {
      await clearPreviewOnPage(true);
    }

    if (els.autoApplyToggle.checked) {
      await performAutoApply();
    }
  });

  els.autoApplyToggle.addEventListener("change", async () => {
    siteData.autoApply = els.autoApplyToggle.checked;
    markSiteDirty();

    if (els.autoApplyToggle.checked) {
      await performAutoApply();
    } else {
      setStatus("Auto Apply turned off.");
    }
  });

  els.siteSummary.addEventListener("input", () => {
    siteData.siteSummary = els.siteSummary.value;
    markSiteDirty();
    scheduleAutoApply();
  });

  els.notesInput.addEventListener("input", () => {
    siteData.notes = els.notesInput.value;
    markSiteDirty();
    scheduleAutoApply();
  });

  els.sortSelectionBtn?.addEventListener("click", () => sortSelectionInEditor(codeEditor));
  els.sortTextRulesBtn?.addEventListener("click", () => sortSelectionInEditor(textRulesEditor));
  els.autocompleteBtn?.addEventListener("click", () => {
    if (codeEditor) {
      codeEditor.focus();
      codeEditor.showHint({ completeSingle: false });
    }
  });

  els.pickElementBtn?.addEventListener("click", async () => {
    if (isPickingElement) {
      await stopElementPicker(true);
    } else {
      await startElementPicker();
    }
  });

  els.sectionNotesBtn?.addEventListener("click", openSectionNotes);
  els.closeSectionNotesBtn?.addEventListener("click", closeSectionNotes);
  els.saveSectionNotesBtn?.addEventListener("click", saveSectionNotes);
  els.sectionNotesModal?.addEventListener("click", e => {
    if (e.target === els.sectionNotesModal) closeSectionNotes();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "BSS_ELEMENT_PICKED") {
      isPickingElement = false;
      els.pickElementBtn?.classList.remove("is-picking");

      insertSelectorIntoEditor(msg.selector || "");
      setStatus(`Picked: ${msg.selector || "selector"}`);
      sendResponse?.({ ok: true });
      return true;
    }

    return false;
  });

  els.helpBtn.addEventListener("click", openHelp);
  els.closeHelpBtn.addEventListener("click", closeHelp);
  els.helpModal.addEventListener("click", e => {
    if (e.target === els.helpModal) closeHelp();
  });

  els.manageSectionsBtn.addEventListener("click", openManageSections);
  els.closeManageSectionsBtn.addEventListener("click", closeManageSections);
  els.manageSectionsModal.addEventListener("click", e => {
    if (e.target === els.manageSectionsModal) closeManageSections();
  });
  els.addSectionBtn.addEventListener("click", addCustomSection);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!els.helpModal.classList.contains("hidden")) closeHelp();
      if (!els.manageSectionsModal.classList.contains("hidden")) closeManageSections();
      if (!els.sectionNotesModal.classList.contains("hidden")) closeSectionNotes();
      if (isPickingElement) {
        void stopElementPicker(false);
      }
    }
  });
}

async function init() {
  const params = getQueryParams();
  currentHost = params.host || "";

  if (!currentHost) {
    els.hostPill.textContent = "No site selected";
    setStatus("Open this editor from the popup.");
    return;
  }

  const linkedTab = await getTabById(params.tabId);
  let bestTab = linkedTab;

  if (!bestTab) {
    bestTab = await findBestCurrentTab(currentHost);
  }

  linkedTabId = bestTab?.id ?? null;

  els.hostPill.textContent = currentHost;
  els.hostnameInput.value = currentHost;
  els.urlInput.value = bestTab?.url || "(No tab linked right now)";

  initEditors();
  bindEvents();
  await loadAllData();
  switchSection("siteSettings");
}

document.addEventListener("DOMContentLoaded", init);