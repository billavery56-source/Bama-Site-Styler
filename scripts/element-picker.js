(() => {

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

  // ...rest of your original element-picker.js stays below...
})();

  const OVERLAY_ID = "bss-picker-overlay";
  const LABEL_ID = "bss-picker-label";

  let pickerActive = false;
  let currentTarget = null;

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.position = "fixed";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483646";
      overlay.style.border = "2px solid #ffb347";
      overlay.style.background = "rgba(255, 179, 71, 0.10)";
      overlay.style.boxShadow = "0 0 0 1px rgba(0,0,0,.45), 0 0 12px rgba(255,179,71,.35)";
      overlay.style.display = "none";
      document.documentElement.appendChild(overlay);
    }

    let label = document.getElementById(LABEL_ID);
    if (!label) {
      label = document.createElement("div");
      label.id = LABEL_ID;
      label.style.position = "fixed";
      label.style.pointerEvents = "none";
      label.style.zIndex = "2147483647";
      label.style.padding = "6px 10px";
      label.style.borderRadius = "10px";
      label.style.background = "rgba(20, 0, 0, 0.95)";
      label.style.border = "1px solid #ffb347";
      label.style.color = "#ffe3b0";
      label.style.font = "12px/1.2 Segoe UI, Arial, sans-serif";
      label.style.whiteSpace = "nowrap";
      label.style.maxWidth = "60vw";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.display = "none";
      document.documentElement.appendChild(label);
    }

    return { overlay, label };
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    const label = document.getElementById(LABEL_ID);
    if (overlay) overlay.style.display = "none";
    if (label) label.style.display = "none";
  }

  function buildSimpleSelector(el) {
    if (!(el instanceof Element)) return "";

    const tag = el.tagName.toLowerCase();

    if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }

    const classList = Array.from(el.classList || [])
      .filter(cls => cls && !cls.startsWith("cm-") && !cls.startsWith("bss-"))
      .slice(0, 3);

    if (classList.length) {
      return `${tag}.${classList.map(c => CSS.escape(c)).join(".")}`;
    }

    const parent = el.parentElement;
    if (!parent) return tag;

    const sameTagSiblings = Array.from(parent.children).filter(
      node => node.tagName === el.tagName
    );

    if (sameTagSiblings.length > 1) {
      const index = sameTagSiblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${index})`;
    }

    return tag;
  }

  function buildSmartSelector(el) {
    if (!(el instanceof Element)) return "";

    if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }

    const parts = [];
    let node = el;
    let depth = 0;

    while (node && node.nodeType === 1 && depth < 4) {
      let part = buildSimpleSelector(node);
      if (!part) break;

      parts.unshift(part);

      if (node.id) break;

      node = node.parentElement;
      depth += 1;
    }

    return parts.join(" > ");
  }

  function updateOverlay(target) {
    const { overlay, label } = ensureOverlay();

    if (!(target instanceof Element)) {
      hideOverlay();
      return;
    }

    const rect = target.getBoundingClientRect();

    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const selector = buildSmartSelector(target) || target.tagName.toLowerCase();

    label.textContent = selector;
    label.style.display = "block";

    const labelTop = Math.max(6, rect.top - 34);
    let labelLeft = rect.left;

    const maxLeft = window.innerWidth - 320;
    if (labelLeft > maxLeft) labelLeft = maxLeft;
    if (labelLeft < 6) labelLeft = 6;

    label.style.left = `${labelLeft}px`;
    label.style.top = `${labelTop}px`;
  }

  function stopPicker() {
    pickerActive = false;
    currentTarget = null;
    hideOverlay();
    document.body.style.cursor = "";
  }

  function startPicker() {
    pickerActive = true;
    currentTarget = null;
    document.body.style.cursor = "crosshair";
  }

  function onMouseMove(e) {
    if (!pickerActive) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    if (target.id === OVERLAY_ID || target.id === LABEL_ID) return;

    currentTarget = target;
    updateOverlay(target);
  }

  function onClickCapture(e) {
    if (!pickerActive) return;

    e.preventDefault();
    e.stopPropagation();

    const target = currentTarget || e.target;
    if (!(target instanceof Element)) {
      stopPicker();
      return;
    }

    const selector = buildSmartSelector(target);
    stopPicker();

    chrome.runtime.sendMessage({
      type: "BSS_ELEMENT_PICKED",
      selector
    });
  }

  function onKeyDown(e) {
    if (!pickerActive) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopPicker();
    }
  }

  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("click", onClickCapture, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", () => {
    if (pickerActive && currentTarget) updateOverlay(currentTarget);
  }, true);
  window.addEventListener("resize", () => {
    if (pickerActive && currentTarget) updateOverlay(currentTarget);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "BSS_START_PICKER") {
      startPicker();
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg?.type === "BSS_STOP_PICKER") {
      stopPicker();
      sendResponse?.({ ok: true });
      return true;
    }

    return false;
  });
})();