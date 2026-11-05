"use strict";

(() => {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const emailIndexes = new Map();
  const nameIndexes = new Map();
  const taskIndexes = new Map();
  const taskTitles = new Map();
  const linkValues = new WeakMap();
  const emailValues = new WeakMap();
  const summaryLabels = new WeakMap();
  const registeredLinks = new WeakSet();
  const registeredSummaries = new WeakSet();
  let nextEmailIndex = 0;
  let nextTaskIndex = 0;
  let updateQueued = false;

  function emailIndex(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return 0;
    const fakeMatch = normalized.match(/^user(\d+)@gmail\.com$/);
    if (fakeMatch) {
      const index = Number(fakeMatch[1]);
      emailIndexes.set(normalized, index);
      return index;
    }
    if (!emailIndexes.has(normalized)) emailIndexes.set(normalized, ++nextEmailIndex);
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

  function taskIdentity(element) {
    const href = linkValues.get(element)?.href || element.getAttribute("href") || "";
    const key = href.match(/\/browse\/([^/?#]+)/i)?.[1];
    return key || linkValues.get(element)?.text || element.textContent.trim();
  }

  function registerLinkedTaskTitles(root) {
    root.querySelectorAll(".task-link, .issue-key, a[href*='/browse/']").forEach((link) => {
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

    root.querySelectorAll(".issue-summary").forEach((summary) => {
      if (registeredSummaries.has(summary)) return;
      registeredSummaries.add(summary);
      const block = summary.closest(".issue-block");
      const key = block?.querySelector(".issue-key");
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
    return text.replace(emailPattern, (email) => fakeEmail(email));
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

    root.querySelectorAll(".issue-key, .task-link, a[href*='/browse/']").forEach((link) => {
      const label = `Задача ${taskIndex(taskIdentity(link))}`;
      setText(link, label);
      link.setAttribute("href", "#");
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });

    root.querySelectorAll(".issue-summary").forEach((summary) => {
      const block = summary.closest(".issue-block");
      const key = block?.querySelector(".issue-key");
      const label = summaryLabels.get(summary) || (key ? `Задача ${taskIndex(taskIdentity(key))}` : `Задача ${taskIndex(summary.textContent)}`);
      setText(summary, label);
      summary.setAttribute("title", label);
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

    root.querySelectorAll("a[href]").forEach((link) => {
      if (/\/browse\/[^/?#]+/i.test(link.getAttribute("href") || "")) {
        link.setAttribute("href", "#");
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
    });
  }

  window.DemoMask = Object.freeze({ email: fakeEmail, name: (name, email) => `User${registerUser(email, name)}` });

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
