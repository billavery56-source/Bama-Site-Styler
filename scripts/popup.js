const STORAGE_KEY = "siteStylesByHost";
const EDITOR_PAGE = "editor.html";

const els = {
  siteName: document.getElementById("siteName"),
  enabledToggle: document.getElementById("enabledToggle"),
  openEditorBtn: document.getElementById("openEditorBtn"),
  saveToggleBtn: document.getElementById("saveToggleBtn"),
  status: document.getElementById("status")
};

let currentTab = null;
let currentHost = "";
let currentUrl = "";

function setStatus(message) {
  els.status.textContent = message;
}

function canEditUrl(url) {
  return Boolean(
    url &&
    !url.startsWith("chrome://") &&
    !url.startsWith("edge://") &&
    !url.startsWith("about:") &&
    !url.startsWith("chrome-extension://")
  );
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0] || null;
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function loadCurrentSite() {
  currentTab = await getActiveTab();
  currentUrl = currentTab?.url || "";
  currentHost = getHostFromUrl(currentUrl);

  if (!canEditUrl(currentUrl) || !currentHost) {
    els.siteName.textContent = "This page is not editable";
    els.enabledToggle.disabled = true;
    els.saveToggleBtn.disabled = true;
    els.openEditorBtn.disabled = true;
    setStatus("Open a regular website tab.");
    return;
  }

  els.siteName.textContent = currentHost;

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const allSites = data[STORAGE_KEY] || {};
  const siteData = allSites[currentHost] || {};

  els.enabledToggle.checked = siteData.enabled !== false;
  setStatus("Ready.");
}

async function saveEnabledState() {
  if (!currentHost) return;

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const allSites = data[STORAGE_KEY] || {};
  const existing = allSites[currentHost] || {};

  allSites[currentHost] = {
    ...existing,
    enabled: els.enabledToggle.checked,
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: allSites });

  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: "BSS_REAPPLY" });
  } catch (err) {
    console.warn("Popup reapply failed:", err);
  }

  setStatus("Saved.");
}

async function openEditor() {
  if (!currentHost) return;

  const url = chrome.runtime.getURL(
    `${EDITOR_PAGE}?host=${encodeURIComponent(currentHost)}&tabId=${encodeURIComponent(currentTab.id || "")}`
  );
  await chrome.tabs.create({ url });
}

els.saveToggleBtn.addEventListener("click", saveEnabledState);
els.openEditorBtn.addEventListener("click", openEditor);
document.addEventListener("DOMContentLoaded", loadCurrentSite);