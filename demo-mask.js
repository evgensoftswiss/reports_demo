"use strict";

(() => {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const emailIndexes = new Map();
  const emailByIndex = new Map();
  const nameIndexes = new Map();
  const taskIndexes = new Map();
  const taskTitles = new Map();
  const meetingIndexes = new Map();
  const linkValues = new WeakMap();
  const emailValues = new WeakMap();
  const summaryLabels = new WeakMap();
  const meetingValues = new WeakMap();
  const calendarUrlValues = new WeakMap();
  const meetingCellValues = new WeakMap();
  const registeredLinks = new WeakSet();
  const registeredSummaries = new WeakSet();
  let nextEmailIndex = 0;
  let nextTaskIndex = 0;
  let nextMeetingIndex = 0;
  let updateQueued = false;

  function emailIndex(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return 0;
    const fakeMatch = normalized.match(/^user(\d+)@gmail\.com$/);
    if (fakeMatch) {
      const index = Number(fakeMatch[1]);
      emailIndexes.set(normalized, index);
      if (!emailByIndex.has(index)) emailByIndex.set(index, normalized);
      return index;
    }
    if (!emailIndexes.has(normalized)) {
      const index = ++nextEmailIndex;
      emailIndexes.set(normalized, index);
      emailByIndex.set(index, normalized);
    }
    return emailIndexes.get(normalized);
  }

  function fakeEmail(value) {
    const index = emailIndex(value);
    return index ? `user${index}@gmail.com` : "";
  }

  function registerUser(email, name) {
    const index = emailIndex(email);
    const normalizedName = String(name || "").trim().toLowerCase();
    if (index && normalizedName) nameIndexes.set(normalizedName, index);
    return index;
  }

  function taskIndex(identity) {
    const normalized = String(identity || "").trim().toLowerCase();
    if (!normalized) return ++nextTaskIndex;
    if (!taskIndexes.has(normalized)) taskIndexes.set(normalized, ++nextTaskIndex);
    return taskIndexes.get(normalized);
  }

  function meetingLabel(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    const key = normalized.toLowerCase();
    if (!meetingIndexes.has(key)) meetingIndexes.set(key, `Meet${++nextMeetingIndex}`);
    return meetingIndexes.get(key);
  }

  function maskCalendarUrl(value) {
    return value ? "https://calendar.example.invalid/hidden.ics" : "";
  }

  function restoreCalendarUrl(value, original) {
    return value === maskCalendarUrl(original) ? original : value;
  }

  function taskIdentity(element) {
    const href = linkValues.get(element)?.href || element.getAttribute("href") || "";
    const key = href.match(/\/browse\/([^/?#]+)/i)?.[1];
    return key || linkValues.get(element)?.text || element.textContent.trim();
  }

  function registerLinkedTaskTitles(root) {
    root.querySelectorAll(".task-link, .issue-key, .issue-drawer-key, a[href*='/browse/']").forEach((link) => {
      if (registeredLinks.has(link)) return;
      linkValues.set(link, { href: link.getAttribute("href") || "", text: link.textContent.trim() });
      registeredLinks.add(link);
      const identity = taskIdentity(link);
      if (!identity) return;
      const label = `Задача ${taskIndex(identity)}`;
      if (link.matches(".issue-key") || (!link.matches(".task-link") && !link.closest(".dist-table"))) return;
      const parent = link.parentElement;
      if (!parent || !parent.matches("div, td")) return;
      const summary = parent.textContent.replace(link.textContent, "").replace(/^\s*[—-]\s*/, "").trim();
      if (summary) taskTitles.set(summary, label);
    });

    root.querySelectorAll(".issue-summary, .issue-drawer-title").forEach((summary) => {
      if (registeredSummaries.has(summary)) return;
      registeredSummaries.add(summary);
      const block = summary.closest(".issue-block");
      const key = block?.querySelector(".issue-key") || summary.closest(".issue-drawer")?.querySelector(".issue-drawer-key");
      const original = summary.getAttribute("title") || summary.textContent.trim();
      const label = key ? `Задача ${taskIndex(taskIdentity(key))}` : `Задача ${taskIndex(original)}`;
      taskTitles.set(original.trim(), label);
      summaryLabels.set(summary, label);
    });
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function maskKnownText(value) {
    let text = value;
    const replaceWholePhrase = (source, replacement) => {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "giu");
      return text.replace(pattern, (_, prefix) => `${prefix}${replacement}`);
    };
    for (const [actual, label] of nameIndexes) {
      if (actual) text = replaceWholePhrase(actual, `User${label}`);
    }
    for (const [actual, label] of taskTitles) {
      if (actual) text = replaceWholePhrase(actual, label);
    }
    for (const [actual, label] of meetingIndexes) {
      if (actual) text = replaceWholePhrase(actual, label);
    }
    return text.replace(emailPattern, (email) => fakeEmail(email));
  }

  function unmaskKnownText(value) {
    let text = String(value || "");
    for (const [actual, label] of nameIndexes) {
      if (actual) text = text.replace(new RegExp(`\\bUser${label}\\b`, "g"), actual);
    }
    for (const [actual, label] of taskTitles) {
      if (actual) text = text.split(label).join(actual);
    }
    for (const [actual, label] of meetingIndexes) {
      if (actual) text = text.split(label).join(actual);
    }
    text = text.replace(/\buser(\d+)@gmail\.com\b/gi, (alias, index) => emailByIndex.get(Number(index)) || alias);
    return text;
  }

  function maskEditableValues(root) {
    root.querySelectorAll('input:not([type="date"]):not([type="number"]):not([type="password"]):not([type="email"]):not([type="url"]), textarea').forEach((field) => {
      if (field.id === "emailInput" || field.id === "emailCodeInput" || field.matches('[data-meeting-prop="summary"], [data-meeting-field="summary"]')) return;
      const masked = maskKnownText(field.value);
      if (masked !== field.value) {
        field.value = masked;
        if (field instanceof HTMLTextAreaElement) field.textContent = masked;
      }
    });
  }

  function apply(root) {
    if (!(root instanceof Element || root instanceof Document)) return;
    registerLinkedTaskTitles(root);

    root.querySelectorAll(".user-details").forEach((details) => {
      const name = details.children[0];
      const email = details.querySelector(".user-email-label");
      if (email && !emailValues.has(email)) emailValues.set(email, email.textContent.match(emailPattern)?.[0] || "");
      const actualEmail = emailValues.get(email) || "";
      const index = registerUser(actualEmail, name?.textContent);
      if (index && name) setText(name, `User${index}`);
      if (email && actualEmail) setText(email, `(${fakeEmail(actualEmail)})`);
    });

    root.querySelectorAll(".user-meta").forEach((meta) => {
      const name = meta.querySelector(".user-name");
      const email = meta.querySelector(".user-email");
      if (email && !emailValues.has(email)) emailValues.set(email, email.textContent.match(emailPattern)?.[0] || "");
      const actualEmail = emailValues.get(email) || "";
      const index = registerUser(actualEmail, name?.textContent);
      if (index && name) setText(name, `User${index}`);
      if (email && actualEmail) setText(email, fakeEmail(actualEmail));
      const avatar = meta.parentElement?.querySelector(".avatar");
      if (avatar) {
        avatar.querySelector("img")?.remove();
        avatar.classList.remove("has-image");
        const initials = avatar.querySelector("span");
        if (initials && index) setText(initials, `U${index}`);
      }
    });

    root.querySelectorAll(".user-avatar").forEach((avatar) => avatar.remove());

    root.querySelectorAll(".issue-key, .issue-drawer-key, .task-link, a[href*='/browse/']").forEach((link) => {
      const label = `Задача ${taskIndex(taskIdentity(link))}`;
      setText(link, label);
      link.setAttribute("href", "#");
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });

    root.querySelectorAll(".issue-summary, .issue-drawer-title").forEach((summary) => {
      const block = summary.closest(".issue-block");
      const key = block?.querySelector(".issue-key") || summary.closest(".issue-drawer")?.querySelector(".issue-drawer-key");
      const label = summaryLabels.get(summary) || (key ? `Задача ${taskIndex(taskIdentity(key))}` : `Задача ${taskIndex(summary.textContent)}`);
      setText(summary, label);
      summary.setAttribute("title", label);
    });

    root.querySelectorAll('input[data-meeting-prop="summary"], input[data-meeting-field="summary"]').forEach((input) => {
      const displayed = input.value;
      let stored = meetingValues.get(input);
      if (!stored) {
        stored = { original: displayed, label: meetingLabel(displayed) };
      } else if (displayed !== stored.label) {
        stored = { original: displayed, label: meetingLabel(displayed) };
      }
      meetingValues.set(input, stored);
      if (displayed && stored.label) {
        input.value = stored.label;
        input.setAttribute("value", stored.label);
      }
    });

    root.querySelectorAll("table.meetings tbody tr td:first-child").forEach((cell) => {
      const displayed = cell.textContent.trim();
      let stored = meetingCellValues.get(cell);
      if (!stored || displayed !== stored.label) {
        stored = { original: displayed, label: meetingLabel(displayed) };
        meetingCellValues.set(cell, stored);
      }
      if (displayed && stored.label) setText(cell, stored.label);
    });

    root.querySelectorAll("#calendarInput, #profileCalendar").forEach((input) => {
      const displayed = input.value;
      let original = calendarUrlValues.get(input);
      if (original === undefined || displayed !== maskCalendarUrl(original)) {
        original = displayed;
        calendarUrlValues.set(input, original);
      }
      if (original) input.value = maskCalendarUrl(original);
    });

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => setText(node, maskKnownText(node.textContent)));

    root.querySelectorAll("[title], [alt]").forEach((element) => {
      for (const attribute of ["title", "alt"]) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, maskKnownText(element.getAttribute(attribute)));
      }
    });

    maskEditableValues(root);

    root.querySelectorAll("a[href]").forEach((link) => {
      if (/\/browse\/[^/?#]+/i.test(link.getAttribute("href") || "")) {
        link.setAttribute("href", "#");
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
    });
  }

  window.DemoMask = Object.freeze({
    email: fakeEmail,
    name: (name, email) => `User${registerUser(email, name)}`,
    meeting: meetingLabel,
    calendarUrl: maskCalendarUrl,
    restoreCalendarUrl,
    unmaskText: unmaskKnownText
  });

  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (field.matches('[data-meeting-prop="summary"], [data-meeting-field="summary"]')) {
      queueMicrotask(() => {
        if (field.isConnected) apply(field.parentElement || document);
      });
      return;
    }
    if (field.id === "emailInput" || field.id === "emailCodeInput") return;
    const original = unmaskKnownText(field.value);
    if (original === field.value) return;
    field.value = original;
    queueMicrotask(() => {
      if (!field.isConnected) return;
      const masked = maskKnownText(field.value);
      field.value = masked;
      if (field instanceof HTMLTextAreaElement) field.textContent = masked;
    });
  }, true);

  const observe = () => {
    apply(document);
    const observer = new MutationObserver(() => {
      if (updateQueued) return;
      updateQueued = true;
      queueMicrotask(() => {
        updateQueued = false;
        apply(document);
      });
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
  else observe();
})();
