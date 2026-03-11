(() => {
  const SITE_STORAGE_KEY = "siteStylesByHost";
  const GLOBAL_LAYOUT_KEY = "bssGlobalLayout";

  const SAVED_STYLE_ID = "bama-site-styler-style";
  const PREVIEW_STYLE_ID = "bama-site-styler-preview-style";

  const SAVED_RULE_ATTR = "data-bss-rules";
  const PREVIEW_RULE_ATTR = "data-bss-preview-rules";

  let observer = null;
  let applyTimer = null;
  let isDead = false;

  const host = location.hostname;

  // In-memory preview state
  let previewCssText = "";
  let previewTextRulesText = "";

  function isContextDeadError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("extension context invalidated");
  }

  function kill() {
    if (isDead) return;
    isDead = true;

    clearTimeout(applyTimer);

    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function contextAlive() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function ensureStyleTag(id) {
    let styleEl = document.getElementById(id);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = id;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    return styleEl;
  }

  function setStyleCss(id, css) {
    const styleEl = ensureStyleTag(id);
    styleEl.textContent = css || "";
  }

  function clearStyleCss(id) {
    const styleEl = document.getElementById(id);
    if (styleEl) {
      styleEl.textContent = "";
    }
  }

  function cssEscapeSafe(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function parseTextRules(raw, classPrefix = "bss-rule-") {
    if (!raw || !raw.trim()) return [];

    const lines = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("#"));

    const rules = [];

    for (const line of lines) {
      const parts = line.split("|").map(part => part.trim());
      if (parts.length < 3) continue;

      const [selector, regexSource, declarations] = parts;
      if (!selector || !regexSource || !declarations) continue;

      try {
        rules.push({
          selector,
          regex: new RegExp(regexSource),
          declarations,
          className: `${classPrefix}${cssEscapeSafe(selector + "_" + regexSource)}`,
          id: `${selector}|${regexSource}`
        });
      } catch {
        // Ignore bad regex
      }
    }

    return rules;
  }

  function clearManagedClasses(attrName, classPrefix) {
    const nodes = document.querySelectorAll(`[${attrName}]`);

    for (const node of nodes) {
      for (const cls of Array.from(node.classList)) {
        if (cls.startsWith(classPrefix)) {
          node.classList.remove(cls);
        }
      }
      node.removeAttribute(attrName);
    }
  }

  function normalizeLayoutSections(globalLayout) {
    if (globalLayout && Array.isArray(globalLayout.sections)) {
      return globalLayout.sections
        .map(section => ({
          id: String(section?.id || "").trim(),
          label: String(section?.label || "").trim(),
          type: section?.type === "custom" ? "custom" : "builtin"
        }))
        .filter(section => section.id);
    }

    return [
      { id: "backgrounds", label: "Background Settings", type: "builtin" },
      { id: "fonts", label: "Font Settings", type: "builtin" },
      { id: "fontColors", label: "Font Color Settings", type: "builtin" },
      { id: "sizes", label: "Sizes / Spacing", type: "builtin" },
      { id: "images", label: "Image Settings", type: "builtin" },
      { id: "icons", label: "New Icons", type: "builtin" },
      { id: "cssMisc", label: "Misc CSS", type: "builtin" }
    ];
  }

  function normalizeSiteCssBySection(siteData) {
    const cssBySection = {};

    if (siteData?.cssBySection && typeof siteData.cssBySection === "object") {
      for (const [key, value] of Object.entries(siteData.cssBySection)) {
        cssBySection[key] = value || "";
      }
      return cssBySection;
    }

    if (Array.isArray(siteData?.sections)) {
      for (const section of siteData.sections) {
        if (section?.id) {
          cssBySection[String(section.id)] = section.css || "";
        }
      }
      return cssBySection;
    }

    cssBySection.backgrounds = siteData?.backgrounds || "";
    cssBySection.fonts = siteData?.fonts || "";
    cssBySection.fontColors = siteData?.fontColors || "";
    cssBySection.sizes = siteData?.sizes || "";
    cssBySection.images = siteData?.images || "";
    cssBySection.icons = siteData?.icons || "";
    cssBySection.cssMisc = siteData?.cssMisc || "";

    return cssBySection;
  }

  function buildSavedCss(layout, siteData, rules) {
    const parts = [];
    const sections = normalizeLayoutSections(layout);
    const cssBySection = normalizeSiteCssBySection(siteData || {});

    for (const section of sections) {
      const css = cssBySection[section.id] || "";
      if (css.trim()) {
        parts.push(`/* ${section.label || section.id} */\n${css}`);
      }
    }

    if (rules.length) {
      parts.push(
        "/* Text Match Rule Classes */\n" +
          rules.map(rule => `.${rule.className} { ${rule.declarations} }`).join("\n")
      );
    }

    return parts.join("\n\n");
  }

  function buildPreviewCss(cssText, rules) {
    const parts = [];

    if (cssText && cssText.trim()) {
      parts.push(`/* Live Preview CSS */\n${cssText}`);
    }

    if (rules.length) {
      parts.push(
        "/* Live Preview Text Match Rule Classes */\n" +
          rules.map(rule => `.${rule.className} { ${rule.declarations} }`).join("\n")
      );
    }

    return parts.join("\n\n");
  }

  function applyTextRules(rules, attrName) {
    for (const rule of rules) {
      let nodes = [];

      try {
        nodes = document.querySelectorAll(rule.selector);
      } catch {
        continue;
      }

      for (const node of nodes) {
        const text = (node.textContent || "").trim();
        const match = rule.regex.test(text);

        if (match) {
          node.classList.add(rule.className);

          const existing = (node.getAttribute(attrName) || "")
            .split("||")
            .filter(Boolean);

          if (!existing.includes(rule.id)) {
            existing.push(rule.id);
          }

          node.setAttribute(attrName, existing.join("||"));
        } else {
          node.classList.remove(rule.className);

          const existing = (node.getAttribute(attrName) || "")
            .split("||")
            .filter(Boolean)
            .filter(id => id !== rule.id);

          if (existing.length) {
            node.setAttribute(attrName, existing.join("||"));
          } else {
            node.removeAttribute(attrName);
          }
        }
      }
    }
  }

  async function getAllData() {
    if (isDead) return null;

    if (!contextAlive()) {
      kill();
      return null;
    }

    try {
      const result = await chrome.storage.local.get([SITE_STORAGE_KEY, GLOBAL_LAYOUT_KEY]);
      const allSites = result[SITE_STORAGE_KEY] || {};
      const siteData = allSites[host] || null;
      const layout = result[GLOBAL_LAYOUT_KEY] || null;
      return { siteData, layout };
    } catch (err) {
      if (isContextDeadError(err)) {
        kill();
        return null;
      }
      return null;
    }
  }

  function applySavedLayer(siteData, layout) {
    const enabled = !!siteData && siteData.enabled !== false;
    const savedRules = enabled
      ? parseTextRules(siteData.textRules || "", "bss-rule-")
      : [];

    if (!enabled) {
      clearStyleCss(SAVED_STYLE_ID);
      clearManagedClasses(SAVED_RULE_ATTR, "bss-rule-");
      return;
    }

    const css = buildSavedCss(layout, siteData, savedRules);
    setStyleCss(SAVED_STYLE_ID, css);

    clearManagedClasses(SAVED_RULE_ATTR, "bss-rule-");
    applyTextRules(savedRules, SAVED_RULE_ATTR);
  }

  function applyPreviewLayer() {
    const previewRules = parseTextRules(previewTextRulesText || "", "bss-preview-rule-");
    const previewCss = buildPreviewCss(previewCssText || "", previewRules);

    setStyleCss(PREVIEW_STYLE_ID, previewCss);

    clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");

    if (previewRules.length) {
      applyTextRules(previewRules, PREVIEW_RULE_ATTR);
    }
  }

  async function applyEverything() {
    if (isDead) return;

    if (!contextAlive()) {
      kill();
      return;
    }

    try {
      ensureStyleTag(SAVED_STYLE_ID);
      ensureStyleTag(PREVIEW_STYLE_ID);

      const data = await getAllData();
      if (isDead) return;

      const siteData = data?.siteData || null;
      const layout = data?.layout || null;

      applySavedLayer(siteData, layout);
      applyPreviewLayer();
    } catch (err) {
      if (isContextDeadError(err)) {
        kill();
      }
    }
  }

  function scheduleApply(wait = 150) {
    if (isDead) return;

    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      if (isDead) return;
      void applyEverything();
    }, wait);
  }

  function startObserver() {
    if (isDead || !document.documentElement) return;

    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (isDead) return;
      scheduleApply(150);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (isDead) {
        sendResponse?.({ ok: false, error: "dead" });
        return false;
      }

      // Existing full reapply
      if (msg?.type === "BSS_REAPPLY") {
        (async () => {
          try {
            await applyEverything();
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "apply_failed" });
          }
        })();
        return true;
      }

      // New live preview API
      if (
        msg?.type === "BSS_SET_PREVIEW" ||
        msg?.action === "bss:set-preview-css"
      ) {
        previewCssText = String(msg?.css || "");
        previewTextRulesText = String(msg?.textRules || "");

        applyPreviewLayer();
        sendResponse?.({ ok: true });
        return false;
      }

      if (
        msg?.type === "BSS_CLEAR_PREVIEW" ||
        msg?.action === "bss:clear-preview"
      ) {
        previewCssText = "";
        previewTextRulesText = "";

        clearStyleCss(PREVIEW_STYLE_ID);
        clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");

        sendResponse?.({ ok: true });
        return false;
      }

      if (
        msg?.type === "BSS_SET_SAVED_CSS" ||
        msg?.action === "bss:set-saved-css"
      ) {
        // Optional convenience path:
        // lets the editor force the saved layer immediately after storage save
        const css = String(msg?.css || "");

        setStyleCss(SAVED_STYLE_ID, css);
        previewCssText = "";
        previewTextRulesText = "";

        clearStyleCss(PREVIEW_STYLE_ID);
        clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");

        sendResponse?.({ ok: true });
        return false;
      }

      if (
        msg?.type === "BSS_DISABLE_ALL" ||
        msg?.action === "bss:disable-all"
      ) {
        clearStyleCss(SAVED_STYLE_ID);
        clearStyleCss(PREVIEW_STYLE_ID);
        clearManagedClasses(SAVED_RULE_ATTR, "bss-rule-");
        clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");

        sendResponse?.({ ok: true });
        return false;
      }

      return false;
    });
  } catch {
    kill();
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (isDead) return;
      if (areaName !== "local") return;
      if (!changes[SITE_STORAGE_KEY] && !changes[GLOBAL_LAYOUT_KEY]) return;
      scheduleApply(150);
    });
  } catch {
    kill();
  }

  window.addEventListener("pagehide", () => {
    kill();
  });

  window.addEventListener("beforeunload", () => {
    kill();
  });

  function init() {
    if (isDead) return;

    if (!contextAlive()) {
      kill();
      return;
    }

    ensureStyleTag(SAVED_STYLE_ID);
    ensureStyleTag(PREVIEW_STYLE_ID);

    void applyEverything();
    startObserver();
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  } catch {
    kill();
  }
})();