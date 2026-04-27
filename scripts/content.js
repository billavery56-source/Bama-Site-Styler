(() => {
  function shouldSkipPage() {
    try {
      const protocol = String(location.protocol || "").toLowerCase();
      const href = String(location.href || "").toLowerCase();

      const blockedProtocols = new Set([
        "chrome:",
        "chrome-devtools:",
        "devtools:",
        "edge:",
        "about:",
        "view-source:",
        "moz-extension:",
        "chrome-extension:"
      ]);

      if (blockedProtocols.has(protocol)) return true;
      if (href.startsWith("chrome-devtools://")) return true;
      if (!(document instanceof HTMLDocument)) return true;
      if (!document.documentElement) return true;

      return false;
    } catch {
      return true;
    }
  }

  if (shouldSkipPage()) {
    return;
  }

  const SITE_STORAGE_KEY = "siteStylesByHost";
  const GLOBAL_LAYOUT_KEY = "bssGlobalLayout";

  const SAVED_STYLE_ID = "bama-site-styler-style";
  const PREVIEW_STYLE_ID = "bama-site-styler-preview-style";

  const SAVED_RULE_ATTR = "data-bss-rules";
  const PREVIEW_RULE_ATTR = "data-bss-preview-rules";
  const ROOT_CLASS = "bama-styler-active";

  let observer = null;
  let applyTimer = null;
  let isDead = false;

  const host = location.hostname;

  let previewCssText = "";
  let previewTextRulesText = "";
  let previewDomScript = "";
  let previewScriptEnabled = false;
  let previewScriptUseDollar = true;
  let previewScriptWatchDom = true;

  let savedRuntime = null;
  let previewRuntime = null;

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

    cleanupRuntime(savedRuntime);
    cleanupRuntime(previewRuntime);
    savedRuntime = null;
    previewRuntime = null;
  }

  function contextAlive() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function ensureRootClass() {
    if (document.documentElement) {
      document.documentElement.classList.add(ROOT_CLASS);
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
        // ignore bad regex
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

  function scopeCss(css) {
    if (!css || !css.trim()) return "";

    const rootPrefix = `html.${ROOT_CLASS}`;

    return css.replace(/(^|})\s*([^@{}][^{]*)\{/g, (match, sep, selectorGroup) => {
      const selectors = selectorGroup
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          if (
            s.startsWith(rootPrefix) ||
            s.startsWith("html.chrome-devtools") ||
            s.startsWith("html.devtools")
          ) {
            return s;
          }
          return `${rootPrefix} ${s}`;
        })
        .join(", ");

      return `${sep}\n${selectors} {`;
    });
  }

  function buildSavedCss(layout, siteData, rules) {
    const parts = [];
    const sections = normalizeLayoutSections(layout);
    const cssBySection = normalizeSiteCssBySection(siteData || {});

    for (const section of sections) {
      const css = cssBySection[section.id] || "";
      if (css.trim()) {
        parts.push(`/* ${section.label || section.id} */\n${scopeCss(css)}`);
      }
    }

    if (rules.length) {
      parts.push(
        "/* Text Match Rule Classes */\n" +
          rules
            .map(rule => `html.${ROOT_CLASS} .${rule.className} { ${rule.declarations} }`)
            .join("\n")
      );
    }

    return parts.join("\n\n");
  }

  function buildPreviewCss(cssText, rules) {
    const parts = [];

    if (cssText && cssText.trim()) {
      parts.push(`/* Live Preview CSS */\n${scopeCss(cssText)}`);
    }

    if (rules.length) {
      parts.push(
        "/* Live Preview Text Match Rule Classes */\n" +
          rules
            .map(rule => `html.${ROOT_CLASS} .${rule.className} { ${rule.declarations} }`)
            .join("\n")
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
          const existing = (node.getAttribute(attrName) || "").split("||").filter(Boolean);
          if (!existing.includes(rule.id)) existing.push(rule.id);
          node.setAttribute(attrName, existing.join("||"));
        } else {
          node.classList.remove(rule.className);
          const existing = (node.getAttribute(attrName) || "")
            .split("||")
            .filter(Boolean)
            .filter(id => id !== rule.id);

          if (existing.length) node.setAttribute(attrName, existing.join("||"));
          else node.removeAttribute(attrName);
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

  function cleanupRuntime(runtime) {
    if (!runtime) return;
    try {
      runtime.observer?.disconnect();
    } catch {}
    for (const fn of runtime.cleanups || []) {
      try {
        fn();
      } catch {}
    }
  }

  function makeRuntime(label) {
    return {
      label,
      cleanups: [],
      observer: null
    };
  }

  function toElements(input, context = document) {
    if (input == null) return [];
    if (typeof input === "string") {
      try {
        return Array.from((context || document).querySelectorAll(input));
      } catch {
        return [];
      }
    }
    if (input instanceof Element || input === window || input === document) return [input];
    if (Array.isArray(input)) return input.flatMap(item => toElements(item, context));
    if (typeof input.length === "number") return Array.from(input).flatMap(item => toElements(item, context));
    return [];
  }

  function setStyleValue(el, prop, value, priority) {
    if (!(el instanceof Element) || !prop) return;
    const raw = String(value ?? "");
    const hasImportant = /\s*!important\s*$/i.test(raw);
    const finalValue = raw.replace(/\s*!important\s*$/i, "").trim();
    const finalPriority = priority || (hasImportant ? "important" : "");
    el.style.setProperty(prop, finalValue, finalPriority);
  }

  function makeCollection(elements) {
    const api = {
      elements,
      length: elements.length,
      each(fn) {
        elements.forEach((el, index) => fn.call(el, index, el));
        return api;
      },
      css(name, value, priority) {
        if (typeof name === "object" && name) {
          Object.entries(name).forEach(([k, v]) => {
            elements.forEach(el => setStyleValue(el, k, v, priority));
          });
          return api;
        }
        if (value === undefined) {
          const el = elements[0];
          return el instanceof Element ? getComputedStyle(el).getPropertyValue(name) : "";
        }
        elements.forEach(el => setStyleValue(el, name, value, priority));
        return api;
      },
      attr(name, value) {
        if (value === undefined) return elements[0]?.getAttribute?.(name) ?? null;
        elements.forEach(el => el instanceof Element && el.setAttribute(name, value));
        return api;
      },
      removeAttr(name) {
        elements.forEach(el => el instanceof Element && el.removeAttribute(name));
        return api;
      },
      addClass(className) {
        elements.forEach(el => el instanceof Element && el.classList.add(...String(className).split(/\s+/).filter(Boolean)));
        return api;
      },
      removeClass(className) {
        elements.forEach(el => el instanceof Element && el.classList.remove(...String(className).split(/\s+/).filter(Boolean)));
        return api;
      },
      toggleClass(className, force) {
        elements.forEach(el => el instanceof Element && el.classList.toggle(className, force));
        return api;
      },
      text(value) {
        if (value === undefined) return elements.map(el => el.textContent || "").join("");
        elements.forEach(el => {
          el.textContent = value;
        });
        return api;
      },
      html(value) {
        if (value === undefined) return elements[0]?.innerHTML ?? "";
        elements.forEach(el => {
          if (el instanceof Element) el.innerHTML = value;
        });
        return api;
      },
      find(selector) {
        return makeCollection(elements.flatMap(el => toElements(selector, el)));
      },
      parent() {
        return makeCollection(elements.map(el => el.parentElement).filter(Boolean));
      },
      children(selector = "") {
        const kids = elements.flatMap(el => Array.from(el.children || []));
        if (!selector) return makeCollection(kids);
        return makeCollection(kids.filter(el => el.matches?.(selector)));
      },
      closest(selector) {
        return makeCollection(elements.map(el => el.closest?.(selector)).filter(Boolean));
      },
      on(type, handler, options) {
        elements.forEach(el => {
          el.addEventListener(type, handler, options);
        });
        return api;
      },
      off(type, handler, options) {
        elements.forEach(el => {
          el.removeEventListener(type, handler, options);
        });
        return api;
      },
      first() {
        return makeCollection(elements.length ? [elements[0]] : []);
      },
      eq(index) {
        return makeCollection(elements[index] ? [elements[index]] : []);
      },
      get(index) {
        return index == null ? elements.slice() : (elements[index] || null);
      }
    };
    return api;
  }

  function makeDollar(runtime) {
    const dollar = function(selector, context) {
      return makeCollection(toElements(selector, context));
    };
    dollar.all = selector => Array.from(document.querySelectorAll(selector));
    dollar.one = selector => document.querySelector(selector);
    dollar.ready = fn => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
      } else {
        fn();
      }
    };
    return dollar;
  }

  function buildScriptApi(runtime) {
    const api = {
      $: makeDollar(runtime),
      $$: selector => Array.from(document.querySelectorAll(selector)),
      one: selector => document.querySelector(selector),
      all: selector => Array.from(document.querySelectorAll(selector)),
      setStyle(el, prop, value, priority = "") {
        setStyleValue(el, prop, value, priority);
      },
      setStyles(target, styles, priority = "") {
        toElements(target).forEach(el => {
          Object.entries(styles || {}).forEach(([prop, value]) => setStyleValue(el, prop, value, priority));
        });
      },
      observe(callback, options = {}) {
        const obs = new MutationObserver(mutations => callback(mutations));
        obs.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: false,
          ...options
        });
        runtime.cleanups.push(() => obs.disconnect());
        return obs;
      },
      on(target, type, handler, options) {
        const nodes = toElements(target);
        nodes.forEach(node => node.addEventListener(type, handler, options));
        runtime.cleanups.push(() => nodes.forEach(node => node.removeEventListener(type, handler, options)));
      },
      off(target, type, handler, options) {
        const nodes = toElements(target);
        nodes.forEach(node => node.removeEventListener(type, handler, options));
      },
      waitFor(selector, callback, options = {}) {
        const existing = document.querySelector(selector);
        if (existing) {
          callback(existing);
          if (options.once !== false) return null;
        }

        const obs = new MutationObserver(() => {
          const found = document.querySelector(selector);
          if (!found) return;
          callback(found);
          if (options.once !== false) obs.disconnect();
        });

        obs.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: !!options.attributes
        });

        runtime.cleanups.push(() => obs.disconnect());
        return obs;
      },
      log(...args) {
        console.log("[BSS Site Script]", ...args);
      },
      cleanup(fn) {
        if (typeof fn === "function") runtime.cleanups.push(fn);
      }
    };
    return api;
  }

  function runUserScript(source, runtime, options = {}) {
    cleanupRuntime(runtime);
    if (!source || !String(source).trim()) return runtime;

    const api = buildScriptApi(runtime);
    const $ = options.useDollar !== false ? api.$ : undefined;
    const $$ = api.$$;

    try {
      const fn = new Function("$", "$$", "api", source);
      fn($, $$, api);
    } catch (err) {
      console.error("[Bama Site Styler] Script error:", err);
    }

    if (options.watchDom !== false) {
      const obs = new MutationObserver(() => {
        try {
          const fn = new Function("$", "$$", "api", source);
          fn($, $$, api);
        } catch (err) {
          console.error("[Bama Site Styler] Script observer error:", err);
        }
      });

      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true
      });
      runtime.observer = obs;
    }

    return runtime;
  }

  function getSavedScriptConfig(siteData) {
    return {
      source: String(siteData?.domScript || ""),
      enabled: !!siteData?.scriptEnabled,
      useDollar: siteData?.scriptUseDollar !== false,
      watchDom: siteData?.scriptWatchDom !== false
    };
  }

  function applySavedLayer(siteData, layout) {
    const enabled = !!siteData && siteData.enabled !== false;
    const savedRules = enabled ? parseTextRules(siteData.textRules || "", "bss-rule-") : [];

    if (!enabled) {
      clearStyleCss(SAVED_STYLE_ID);
      clearManagedClasses(SAVED_RULE_ATTR, "bss-rule-");
      cleanupRuntime(savedRuntime);
      savedRuntime = null;
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

  function applySavedScript(siteData) {
    const cfg = getSavedScriptConfig(siteData);

    cleanupRuntime(savedRuntime);
    savedRuntime = null;

    if (!siteData || siteData.enabled === false || !cfg.enabled || !cfg.source.trim()) return;

    savedRuntime = makeRuntime("saved");
    runUserScript(cfg.source, savedRuntime, {
      useDollar: cfg.useDollar,
      watchDom: cfg.watchDom
    });
  }

  function applyPreviewScript() {
    cleanupRuntime(previewRuntime);
    previewRuntime = null;

    if (!previewScriptEnabled || !String(previewDomScript || "").trim()) return;

    previewRuntime = makeRuntime("preview");
    runUserScript(previewDomScript, previewRuntime, {
      useDollar: previewScriptUseDollar,
      watchDom: previewScriptWatchDom
    });
  }

  async function applyEverything({ rerunScripts = false } = {}) {
    if (isDead) return;

    if (!contextAlive()) {
      kill();
      return;
    }

    try {
      ensureRootClass();
      ensureStyleTag(SAVED_STYLE_ID);
      ensureStyleTag(PREVIEW_STYLE_ID);

      const data = await getAllData();
      if (isDead) return;

      const siteData = data?.siteData || null;
      const layout = data?.layout || null;

      applySavedLayer(siteData, layout);
applyPreviewLayer();

if (rerunScripts) {
  applySavedScript(siteData);
  applyPreviewScript();
}
    } catch (err) {
      if (isContextDeadError(err)) {
        kill();
      }
    }
  }

  function scheduleApply(wait = 150, rerunScripts = false) {
    if (isDead) return;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      if (isDead) return;
      void applyEverything({ rerunScripts });
    }, wait);
  }

  function startObserver() {
  if (isDead || !document.documentElement) return;

  if (observer) observer.disconnect();

  observer = new MutationObserver(() => {
    if (isDead) return;

    // Only re-run text rules / style application when preview script is active.
    // Otherwise leave the page alone so DevTools can inspect normally.
    if (previewScriptEnabled || previewTextRulesText.trim()) {
      scheduleApply(150, false);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (isDead) {
        sendResponse?.({ ok: false, error: "dead" });
        return false;
      }

      if (msg?.type === "BSS_REAPPLY") {
        (async () => {
          try {
            await applyEverything({ rerunScripts: true });
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "apply_failed" });
          }
        })();
        return true;
      }

      if (msg?.type === "BSS_SET_PREVIEW" || msg?.action === "bss:set-preview-css") {
        previewCssText = String(msg?.css || "");
        previewTextRulesText = String(msg?.textRules || "");
        previewDomScript = String(msg?.domScript || "");
        previewScriptEnabled = !!msg?.scriptEnabled;
        previewScriptUseDollar = msg?.scriptUseDollar !== false;
        previewScriptWatchDom = msg?.scriptWatchDom !== false;

        applyPreviewLayer();
        applyPreviewScript();
        sendResponse?.({ ok: true });
        return false;
      }

      if (msg?.type === "BSS_CLEAR_PREVIEW" || msg?.action === "bss:clear-preview") {
        previewCssText = "";
        previewTextRulesText = "";
        previewDomScript = "";
        previewScriptEnabled = false;
        previewScriptUseDollar = true;
        previewScriptWatchDom = true;

        clearStyleCss(PREVIEW_STYLE_ID);
        clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");
        cleanupRuntime(previewRuntime);
        previewRuntime = null;

        sendResponse?.({ ok: true });
        return false;
      }

      if (msg?.type === "BSS_DISABLE_ALL" || msg?.action === "bss:disable-all") {
        clearStyleCss(SAVED_STYLE_ID);
        clearStyleCss(PREVIEW_STYLE_ID);
        clearManagedClasses(SAVED_RULE_ATTR, "bss-rule-");
        clearManagedClasses(PREVIEW_RULE_ATTR, "bss-preview-rule-");
        cleanupRuntime(savedRuntime);
        cleanupRuntime(previewRuntime);
        savedRuntime = null;
        previewRuntime = null;

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
      scheduleApply(150, true);
    });
  } catch {
    kill();
  }

  window.addEventListener("pagehide", kill);
  window.addEventListener("beforeunload", kill);

  function init() {
    if (isDead) return;
    if (!contextAlive()) {
      kill();
      return;
    }

    ensureRootClass();
    ensureStyleTag(SAVED_STYLE_ID);
    ensureStyleTag(PREVIEW_STYLE_ID);

    void applyEverything({ rerunScripts: true });
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