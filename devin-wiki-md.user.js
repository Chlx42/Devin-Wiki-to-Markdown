// ==UserScript==
// @name         Devin-Wiki to Markdown
// @namespace    https://github.com/Chlx42/Devin-Wiki-to-Markdown
// @version      1.0.2
// @description  Convert DeepWiki & Devin Wiki pages to Markdown and batch export as ZIP.
// @author       lixuan
// @license      MIT
// @icon         https://github.com/Chlx42.png
// @homepageURL  https://github.com/Chlx42/Devin-Wiki-to-Markdown
// @supportURL   https://github.com/Chlx42/Devin-Wiki-to-Markdown/issues
// @downloadURL  https://raw.githubusercontent.com/Chlx42/Devin-Wiki-to-Markdown/main/devin-wiki-md.user.js
// @updateURL    https://raw.githubusercontent.com/Chlx42/Devin-Wiki-to-Markdown/main/devin-wiki-md.user.js
// @match        https://deepwiki.com/*
// @match        https://app.devin.ai/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_download
// @connect      deepwiki.com
// @connect      app.devin.ai
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "dwmd-panel";
  const STATUS_ID = "dwmd-status";
  const ACTIONS_ID = "dwmd-actions";
  const STATE_KEY = "dwmd-batch-state-v1";
  const CANCEL_KEY = "dwmd-batch-cancel-v1";
  const CONTENT_KEY_PREFIX = "dwmd-batch-content-v1-";
  const TASK_LOCK = { running: false };

  function applyStyles() {
    const css = `
      #${PANEL_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        width: 300px;
        border-radius: 14px;
        border: 1px solid rgba(18, 24, 38, 0.16);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 12px 36px rgba(8, 19, 38, 0.18);
        backdrop-filter: blur(8px);
        padding: 12px;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #0f172a;
      }
      #${PANEL_ID} * {
        box-sizing: border-box;
      }
      #${PANEL_ID} .dwmd-title {
        font-size: 15px;
        font-weight: 700;
        margin: 0 0 8px;
      }
      #${PANEL_ID} .dwmd-buttons {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }
      #${PANEL_ID} button {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: transform .14s ease, opacity .14s ease;
      }
      #${PANEL_ID} button:hover {
        transform: translateY(-1px);
      }
      #${PANEL_ID} .dwmd-single {
        background: #0f7b0f;
        color: #fff;
      }
      #${PANEL_ID} .dwmd-batch {
        background: #0b63ce;
        color: #fff;
      }
      #${PANEL_ID} .dwmd-cancel {
        background: #9f1239;
        color: #fff;
      }
      #${STATUS_ID} {
        margin-top: 9px;
        font-size: 12px;
        line-height: 1.45;
        border-radius: 8px;
        padding: 8px;
        min-height: 34px;
        border: 1px solid transparent;
        white-space: pre-wrap;
      }
      #${STATUS_ID}.info {
        background: #e0f2fe;
        border-color: #7dd3fc;
        color: #075985;
      }
      #${STATUS_ID}.success {
        background: #dcfce7;
        border-color: #4ade80;
        color: #166534;
      }
      #${STATUS_ID}.error {
        background: #fee2e2;
        border-color: #fda4af;
        color: #991b1b;
      }
      #${ACTIONS_ID} {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${ACTIONS_ID} button {
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        background: #111827;
        color: #fff;
      }
    `;
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }
    applyStyles();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h3 class="dwmd-title">Wiki to Markdown</h3>
      <div class="dwmd-buttons">
        <button type="button" class="dwmd-single" id="dwmd-convert-current">导出当前页 Markdown</button>
        <button type="button" class="dwmd-batch" id="dwmd-convert-all">批量导出全部页面 ZIP</button>
        <button type="button" class="dwmd-cancel" id="dwmd-cancel-batch">取消批量任务</button>
      </div>
      <div id="${STATUS_ID}" class="info">就绪</div>
      <div id="${ACTIONS_ID}"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#dwmd-convert-current").addEventListener("click", () => void exportCurrentPage());
    panel.querySelector("#dwmd-convert-all").addEventListener("click", () => void startBatchExport());
    panel.querySelector("#dwmd-cancel-batch").addEventListener("click", () => void cancelBatchExport());
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }
    GM_registerMenuCommand("Wiki: 导出当前页", () => {
      void exportCurrentPage();
    });
    GM_registerMenuCommand("Wiki: 批量导出全部", () => {
      void startBatchExport();
    });
    GM_registerMenuCommand("Wiki: 取消批量任务", () => {
      void cancelBatchExport();
    });
  }

  function showStatus(message, type = "info") {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }
    status.textContent = message;
    status.className = type;
  }

  function clearActions() {
    const actions = document.getElementById(ACTIONS_ID);
    if (!actions) {
      return;
    }
    actions.replaceChildren();
  }

  function isChromeLikeBrowser() {
    const ua = navigator.userAgent || "";
    return /chrome|chromium|crios|edg\//i.test(ua) && !/firefox/i.test(ua);
  }

  function renderDownloadAction(blob, fileName) {
    const actions = document.getElementById(ACTIONS_ID);
    if (!actions) {
      return;
    }
    actions.replaceChildren();
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `点击下载 ${fileName}`;
    button.addEventListener("click", () => {
      void downloadBlob(blob, fileName);
    });
    actions.appendChild(button);
  }

  async function buildZipBlob(entries) {
    if (typeof fflate === "undefined") {
      throw new Error("fflate 未加载，无法生成 ZIP");
    }
    const encoder = new TextEncoder();
    const files = {};
    entries.forEach((entry) => {
      files[entry.name] = encoder.encode(entry.content);
    });
    const zipData = await new Promise((resolve, reject) => {
      fflate.zip(files, { level: 0 }, (error, data) => {
        if (error) {
          reject(new Error(`ZIP 打包失败: ${String(error)}`));
          return;
        }
        resolve(data);
      });
    });
    return new Blob([zipData], { type: "application/zip" });
  }

  function sanitizeFileName(text) {
    return (text || "")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "Untitled";
  }

  function parseOrderParts(text) {
    const source = String(text || "").trim();
    const match = source.match(/^(\d+(?:\.\d+)*)(?:\D|$)/);
    if (!match) {
      return null;
    }
    const parts = match[1]
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .filter((num) => Number.isFinite(num));
    return parts.length ? parts : null;
  }

  function parseOrderPartsFromUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1] || "";
      const match = last.match(/^(\d+(?:\.\d+)*)(?:-|$)/);
      if (!match) {
        return null;
      }
      return match[1]
        .split(".")
        .map((part) => Number.parseInt(part, 10))
        .filter((num) => Number.isFinite(num));
    } catch (_error) {
      return null;
    }
  }

  function stripOrderPrefix(text) {
    return String(text || "")
      .trim()
      .replace(/^\d+(?:\.\d+)*[\s._-]*/, "")
      .trim();
  }

  function compareOrderParts(partsA, partsB) {
    const a = Array.isArray(partsA) ? partsA : null;
    const b = Array.isArray(partsB) ? partsB : null;
    if (!a && !b) {
      return 0;
    }
    if (a && !b) {
      return -1;
    }
    if (!a && b) {
      return 1;
    }
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i += 1) {
      const av = Number.isFinite(a[i]) ? a[i] : -1;
      const bv = Number.isFinite(b[i]) ? b[i] : -1;
      if (av !== bv) {
        return av - bv;
      }
    }
    return 0;
  }

  function ensureUniqueEntryPath(entryPath, usedSet) {
    const normalized = String(entryPath || "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+|\/+$/g, "");
    const safePath = normalized || "Untitled.md";
    const slashIndex = safePath.lastIndexOf("/");
    const dir = slashIndex >= 0 ? safePath.slice(0, slashIndex) : "";
    const file = slashIndex >= 0 ? safePath.slice(slashIndex + 1) : safePath;
    const dotIndex = file.lastIndexOf(".");
    const stem = dotIndex > 0 ? file.slice(0, dotIndex) : file;
    const ext = dotIndex > 0 ? file.slice(dotIndex) : "";
    let candidate = safePath;
    let suffix = 2;
    while (usedSet.has(candidate.toLowerCase())) {
      const nextFile = `${stem}-${suffix}${ext}`;
      candidate = dir ? `${dir}/${nextFile}` : nextFile;
      suffix += 1;
    }
    usedSet.add(candidate.toLowerCase());
    return candidate;
  }

  function formatHeadTitle(headTitle) {
    return sanitizeFileName(
      (headTitle || "").replace(/[\/|]/g, "-").replace(/---/g, "-")
    );
  }

// --- REPLACED: getCurrentTitle (精准抓取正文大标题) ---
  function getCurrentTitle() {
      // 1. 优先从正文区域 (.prose) 寻找第一个 H1 或 H2
      const contentHeading = document.querySelector('.prose h1, .prose h2, [data-testid="markdown-content"] h1');
      if (contentHeading) {
          // 清洗掉 "Link copied!" 等交互文字
          return contentHeading.textContent
              .replace(/Link copied!/ig, '')
              .replace(/^#\s*/, '')
              .trim();
      }

      // 2. 备选方案：寻找页面中具有标题特征的加粗文本（Devin 的面包屑或顶栏标题）
      const topTitle = document.querySelector('main h1') ||
                       document.querySelector('.truncate.font-semibold') ||
                       document.querySelector('.text-xl.font-semibold');
      if (topTitle) {
          return topTitle.textContent.replace(/Link copied!/ig, '').trim();
      }

      // 3. 最后才考虑浏览器标签标题 (如果是 Wiki — Project 格式，则取后者)
      const docTitle = document.title || "";
      if (docTitle.includes('—')) {
          const parts = docTitle.split('—');
          return parts[parts.length - 1].trim();
      }
      return "Untitled";
  }

  // --- REPLACED: getContentContainer (Devin Compatible) ---
  function getContentContainer() {
      return document.querySelector('.prose') ||
             document.querySelector('[class*="prose dark:prose-invert"]') ||
             document.querySelector('[data-testid="markdown-content"]') ||
             document.querySelector('main');
  }

  async function waitForContentContainer(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const container = getContentContainer();
      if (container && container.childNodes.length > 0) {
        return container;
      }
      await sleep(250);
    }
    throw new Error("页面内容加载超时，未找到可转换的正文区域");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function hasLoadingMarkers(container) {
    return Boolean(
      container.querySelector(
        '[aria-busy="true"], [data-loading="true"], .animate-pulse, [class*="skeleton"]'
      )
    );
  }

  function isDiagramSvgCandidate(svgElement) {
    if (!svgElement) {
      return false;
    }
    const role = (svgElement.getAttribute("aria-roledescription") || "").toLowerCase();
    const cls = (svgElement.getAttribute("class") || "").toLowerCase();
    if (
      role.includes("flowchart") ||
      role.includes("class") ||
      role.includes("sequence") ||
      cls.includes("flowchart") ||
      cls.includes("classdiagram") ||
      cls.includes("sequencediagram") ||
      cls.includes("sequence")
    ) {
      return true;
    }
    return Boolean(
      svgElement.querySelector(
        'g.node, path.flowchart-link, path.relation[id^="id_"], line.actor-line, line[class^="messageLine"], g.cluster, rect.note, foreignObject'
      )
    );
  }

  function getDiagramSvgInPre(preElement) {
    if (!preElement) {
      return null;
    }
    const preferred = preElement.querySelector(
      'svg[id^="mermaid-"], svg[aria-roledescription], svg.flowchart, svg.classDiagram, svg.sequencediagram, svg[class*="flowchart"], svg[class*="classDiagram"], svg[class*="classdiagram"], svg[class*="sequence"]'
    );
    if (preferred && isDiagramSvgCandidate(preferred)) {
      return preferred;
    }
    const allSvg = Array.from(preElement.querySelectorAll("svg"));
    return allSvg.find((svg) => isDiagramSvgCandidate(svg)) || null;
  }

  function isLikelyMermaidPre(preElement) {
    if (
      preElement.querySelector("code.language-mermaid") ||
      preElement.querySelector(".mermaid")
    ) {
      return true;
    }
    if (getDiagramSvgInPre(preElement)) {
      return true;
    }
    const rawText = (preElement.textContent || "").trim();
    return /(flowchart|classDiagram|sequenceDiagram|erDiagram|graph\s+(TD|LR))/i.test(rawText);
  }

  function isMermaidSvgStructReady(svgElement) {
    if (!svgElement) {
      return false;
    }
    const roleDesc = (svgElement.getAttribute("aria-roledescription") || "").toLowerCase();
    const svgClass = (svgElement.getAttribute("class") || "").toLowerCase();
    const textCount = svgElement.querySelectorAll("text, tspan, foreignObject").length;
    const flowNodeCount = svgElement.querySelectorAll("g.node").length;
    const flowEdgeCount = svgElement.querySelectorAll("path.flowchart-link").length;
    const clusterCount = svgElement.querySelectorAll("g.cluster").length;
    const classNodeCount = svgElement.querySelectorAll("g.node.default, g.classGroup").length;
    const classRelationCount = svgElement.querySelectorAll('path.relation[id^="id_"]').length;
    const actorLineCount = svgElement.querySelectorAll("line.actor-line").length;
    const messageLineCount = svgElement.querySelectorAll('line[class^="messageLine"]').length;
    const noteCount = svgElement.querySelectorAll("rect.note").length;
    if (roleDesc.includes("flowchart") || svgClass.includes("flowchart")) {
      return flowNodeCount > 0 && (flowEdgeCount > 0 || clusterCount > 0 || textCount > 0);
    }
    if (roleDesc.includes("class") || svgClass.includes("classdiagram") || svgClass.includes("class")) {
      return classNodeCount > 0 && (classRelationCount > 0 || textCount > 0);
    }
    if (roleDesc.includes("sequence") || svgClass.includes("sequencediagram") || svgClass.includes("sequence")) {
      return actorLineCount > 0 && (messageLineCount > 0 || noteCount > 0 || textCount > 0);
    }
    return textCount > 0 && (flowNodeCount + classNodeCount + actorLineCount + messageLineCount > 0);
  }

  function getMermaidReadiness(container) {
    const mermaidBlocks = Array.from(container.querySelectorAll("pre")).filter((pre) =>
      isLikelyMermaidPre(pre)
    );
    let readyCount = 0;
    mermaidBlocks.forEach((pre) => {
      const codeMermaid = pre.querySelector("code.language-mermaid");
      if (codeMermaid && (codeMermaid.textContent || "").trim().length > 0) {
        readyCount += 1;
        return;
      }
      const svgElement = getDiagramSvgInPre(pre);
      if (svgElement) {
        if (isMermaidSvgStructReady(svgElement)) {
          readyCount += 1;
        }
        return;
      }
      const text = (pre.textContent || "").trim();
      if (/^```mermaid[\s\S]*```$/.test(text)) {
        readyCount += 1;
      }
    });
    return {
      total: mermaidBlocks.length,
      ready: readyCount
    };
  }

  function hasUnreadyPreBlocks(container) {
    const preBlocks = Array.from(container.querySelectorAll("pre"));
    return preBlocks.some((pre) => {
      const code = pre.querySelector("code");
      const codeText = (code?.textContent || "").trim();
      const preText = (pre.textContent || "").trim();
      const svgElement = getDiagramSvgInPre(pre);
      if (svgElement) {
        return !isMermaidSvgStructReady(svgElement) && codeText.length === 0;
      }
      if (codeText.length === 0 && preText.length === 0) {
        const hasChildren = pre.children.length > 0;
        return hasChildren || hasLoadingMarkers(pre);
      }
      return false;
    });
  }

  async function waitForBatchPageContentReady(timeoutMs = 20000) {
    const container = await waitForContentContainer(timeoutMs);
    const start = Date.now();
    let lastSignature = "";
    let stableRounds = 0;
    while (Date.now() - start < timeoutMs) {
      const signature = [
        container.textContent.length,
        container.querySelectorAll("pre").length,
        container.querySelectorAll('svg[id^="mermaid-"], svg[aria-roledescription]').length
      ].join("|");
      if (signature === lastSignature) {
        stableRounds += 1;
      } else {
        lastSignature = signature;
        stableRounds = 0;
      }
      const readiness = getMermaidReadiness(container);
      const mermaidReady = readiness.ready >= readiness.total;
      const hasUnreadyPre = hasUnreadyPreBlocks(container);
      if (!hasLoadingMarkers(container) && stableRounds >= 3 && mermaidReady && !hasUnreadyPre) {
        return;
      }
      await sleep(200);
    }
    const finalReadiness = getMermaidReadiness(container);
    const hasUnreadyPre = hasUnreadyPreBlocks(container);
    console.warn(
      `页面图表等待超时，继续导出（mermaid 就绪 ${finalReadiness.ready}/${finalReadiness.total}，空预块 ${hasUnreadyPre ? "存在" : "无"}）`
    );
  }

  function collectContentDiagnostics(container) {
    const preBlocks = Array.from(container.querySelectorAll("pre"));
    const expectedDiagramCount = preBlocks.filter((pre) => {
      if (pre.querySelector("code.language-mermaid")) {
        return true;
      }
      return Boolean(getDiagramSvgInPre(pre));
    }).length;
    const pendingEmptyPreCount = preBlocks.filter((pre) => {
      const svgElement = getDiagramSvgInPre(pre);
      if (svgElement) {
        return false;
      }
      const code = pre.querySelector("code");
      const codeText = (code?.textContent || "").trim();
      const preText = (pre.textContent || "").trim();
      if (codeText.length > 0 || preText.length > 0) {
        return false;
      }
      return pre.children.length > 0 || hasLoadingMarkers(pre);
    }).length;
    return {
      preCount: preBlocks.length,
      expectedDiagramCount,
      pendingEmptyPreCount
    };
  }

  function getMarkdownDiagnostics(markdown) {
    const content = String(markdown || "");
    return {
      mermaidBlockCount: (content.match(/```mermaid\b/g) || []).length,
      emptyFenceCount: (content.match(/```\s*\r?\n\s*```/g) || []).length
    };
  }

  function validateConversionIntegrity(converted) {
    const issues = [];
    const expectedDiagramCount = converted?.diagnostics?.expectedDiagramCount || 0;
    const pendingEmptyPreCount = converted?.diagnostics?.pendingEmptyPreCount || 0;
    const markdownStats = getMarkdownDiagnostics(converted?.markdown || "");
    if (expectedDiagramCount > 0 && markdownStats.mermaidBlockCount < expectedDiagramCount) {
      issues.push(`Mermaid 数量不足（期望 ${expectedDiagramCount}，实际 ${markdownStats.mermaidBlockCount}）`);
    }
    if (pendingEmptyPreCount > 0) {
      issues.push(`页面仍有未就绪代码块 ${pendingEmptyPreCount} 个`);
    }
    if (markdownStats.emptyFenceCount > 0) {
      issues.push(`检测到空代码块 ${markdownStats.emptyFenceCount} 个`);
    }
    return {
      ok: issues.length === 0,
      issues
    };
  }

// --- REPLACED: convertCurrentPageToMarkdown (附带底部杂质清洗过滤) ---
  async function convertCurrentPageToMarkdown() {
    const contentContainer = await waitForContentContainer();
    const diagnostics = collectContentDiagnostics(contentContainer);
    let markdown = "";
    contentContainer.childNodes.forEach((child) => {
      markdown += processNode(child);
    });

    const title = getCurrentTitle();

    // 🌟 核心清洗逻辑 1：一刀切掉 Devin 右侧边栏和底部的 UI 控制面板
    // 只要碰到下面这些关键词开头的新行，连同它后面的所有内容全部删掉
    markdown = markdown.replace(/\n(?:Refresh this wiki|Last indexed:|Next refresh cost:|Auto-refresh:|On this page|Ask Devin about)[\s\S]*$/i, '');

    // 去除多余的空行processNode
    markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");
    return {
      markdown,
      markdownTitle: sanitizeFileName(title),
      headTitle: formatHeadTitle(document.title || ""),
      diagnostics
    };
  }

// --- REPLACED: extractAllPages (Devin 修复去重误杀版) ---
  function extractAllPages() {
      const baseUrl = window.location.origin;

      // 1. 动态提取当前 Wiki 的基础路径
      const pathParts = window.location.pathname.split('/');
      let basePath = "/wiki/";
      const wikiIndex = pathParts.indexOf('wiki');
      if (wikiIndex !== -1 && pathParts.length > wikiIndex + 1) {
          basePath = pathParts.slice(0, wikiIndex + 2).join('/');
      }

      let pages = [];
      const allLinks = Array.from(document.querySelectorAll("a[href]"));

      allLinks.forEach(link => {
          const absoluteUrl = link.href;

          if (absoluteUrl && absoluteUrl.includes(basePath) && !absoluteUrl.includes('?edit') && !absoluteUrl.includes('/settings')) {
              const btn = link.querySelector('button[aria-label]');
              const titleText = btn ? btn.getAttribute('aria-label').trim() : (link.textContent.trim() || link.getAttribute("title"));

              if (titleText) {
                  pages.push({
                      url: absoluteUrl,
                      title: titleText,
                      selected: link.getAttribute("aria-current") === "page" || (btn && btn.classList.contains('focus-ring'))
                  });
              }
          }
      });

      // 3. 修复后的去重逻辑：保留完整的 Query 和 Hash
      const uniquePages = [];
      const seen = new Set();
      pages.forEach((page) => {
          // 不再剥离参数，直接使用完整的 URL 作为唯一键
          const normalizedUrl = page.url;
          if (!seen.has(normalizedUrl)) {
              seen.add(normalizedUrl);
              uniquePages.push(page);
          }
      });

      console.log("【Wiki 导出插件调试】");
      console.log("- 基础路径 (basePath):", basePath);
      console.log("- 原始抓取到的链接总数:", pages.length);
      console.log("- 去重后链接数量:", uniquePages.length);
      console.log("- 页面列表:", uniquePages);

      return {
          pages: uniquePages,
          currentTitle: getCurrentTitle(),
          headTitle: formatHeadTitle(document.title || ""),
          baseUrl
      };
  }

function normalizeUrl(url) {
    const parsed = new URL(url, window.location.origin);
    // parsed.hash = ""; // 🚨 关键修复：注释掉这行，保留锚点 Hash！
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  }

  function loadBatchState() {
    const raw = GM_getValue(STATE_KEY, "");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`批量状态解析失败: ${String(error)}`);
    }
  }

  function saveBatchState(state) {
    GM_setValue(STATE_KEY, JSON.stringify(state));
  }

  function clearBatchState() {
    GM_deleteValue(STATE_KEY);
  }

  function loadCancelBatchId() {
    return GM_getValue(CANCEL_KEY, "");
  }

  function markBatchCanceled(batchId) {
    GM_setValue(CANCEL_KEY, batchId || "");
  }

  function clearCancelBatchId() {
    GM_deleteValue(CANCEL_KEY);
  }

  function getBatchContentKey(batchId, pageIndex) {
    return `${CONTENT_KEY_PREFIX}${batchId}-${pageIndex}`;
  }

  function saveBatchPageContent(batchId, pageIndex, data) {
    GM_setValue(getBatchContentKey(batchId, pageIndex), JSON.stringify(data));
  }

  function loadBatchPageContent(batchId, pageIndex) {
    const raw = GM_getValue(getBatchContentKey(batchId, pageIndex), "");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`批量内容解析失败: ${String(error)}`);
    }
  }

  function clearBatchContent(state) {
    if (!state?.id || !Array.isArray(state.pages)) {
      return;
    }
    for (let i = 0; i < state.pages.length; i += 1) {
      GM_deleteValue(getBatchContentKey(state.id, i));
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Blob 转 DataURL 失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function downloadBlob(blob, fileName) {
    const objectUrl = URL.createObjectURL(blob);
    const gmDownload = (url) =>
      new Promise((resolve, reject) => {
        let timeoutId = setTimeout(() => {
          reject(new Error("GM_download timeout"));
        }, 120000);
        GM_download({
          url,
          name: fileName,
          saveAs: true,
          onload: () => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            resolve();
          },
          ontimeout: () => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            reject(new Error("GM_download timeout"));
          },
          onerror: (error) => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            reject(
              new Error(
                `GM_download failed: ${error?.error || error?.details || "unknown"}`
              )
            );
          }
        });
      });
    try {
      if (isChromeLikeBrowser()) {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }
      if (typeof GM_download === "function") {
        let gmError = null;
        try {
          await gmDownload(objectUrl);
          return;
        } catch (firstError) {
          gmError = firstError;
          try {
            const dataUrl = await blobToDataUrl(blob);
            await gmDownload(dataUrl);
            return;
          } catch (secondError) {
            gmError = secondError;
          }
        }
        console.warn("GM_download 不可用，回退原生下载:", gmError);
      }
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    }
  }

// --- REPLACED: exportCurrentPage (单页导出专属优化版) ---
  async function exportCurrentPage() {
    try {
      clearActions();
      showStatus("正在转换当前页面...", "info");
      const converted = await convertCurrentPageToMarkdown();
      const integrity = validateConversionIntegrity(converted);
      // 🌟 核心修改 1：如果遇到 Devin 图表语法错误，不再抛出异常中断！
      // 而是仅仅在控制台警告，然后强行继续打包下载，不卡你的流程。
      if (!integrity.ok) {
        console.warn(`[放行警告] 页面图表可能有语法错误: ${integrity.issues.join("；")}`);
        showStatus(`提示: 存在 Devin 生成错误的图表，已强行导出原代码`, "info");
      }

      // 🌟 核心修改 2：强制单页导出的文件名也只使用“纯净大标题”
      const fileName = `${converted.markdownTitle || "Untitled"}.md`;

      await downloadBlob(
        new Blob([converted.markdown], { type: "text/markdown;charset=utf-8" }),
        fileName
      );
      if (integrity.ok) {
        showStatus(`下载完成: ${fileName}`, "success");
      }
    } catch (error) {
      showStatus(`当前页导出失败: ${error.message || String(error)}`, "error");
      console.error("Wiki to Markdown single export error:", error);
    }
  }

// --- REPLACED: startBatchExport (智能嗅探版入口) ---
  async function startBatchExport() {
    try {
      clearActions();
      let currentState = loadBatchState();
      const canceledId = loadCancelBatchId();
      if (currentState && canceledId && currentState.id === canceledId) {
        clearBatchContent(currentState);
        clearBatchState();
        clearCancelBatchId();
        currentState = null;
      }
      if (currentState) {
        showStatus("检测到已有嗅探任务，继续执行中...", "info");
        await runBatchStep();
        return;
      }

      // 不再依赖页面上的 <a> 标签，直接初始化探测状态机
      const folderName = sanitizeFileName(formatHeadTitle(document.title) || "Devin_Wiki_Export");
      const baseUrl = window.location.href.split('#')[0]; // 取 # 前面的基准 URL

      const batchState = {
        id: `${Date.now()}`,
        originUrl: baseUrl,
        folderName,
        probeX: 1, // 大章节计数器
        probeY: 0, // 小节计数器 (0代表顶级章节，如 #1)
        results: [],
        errors: [],
        createdAt: Date.now()
      };

      clearCancelBatchId();
      saveBatchState(batchState);
      showStatus(`启动智能路由嗅探导出...`, "info");
      await runBatchStep();
    } catch (error) {
      showStatus(`嗅探任务启动失败: ${error.message || String(error)}`, "error");
      console.error("Wiki batch start error:", error);
    }
  }

  function cancelBatchExport() {
    clearActions();
    const state = loadBatchState();
    if (!state) {
      showStatus("当前没有批量任务", "info");
      return;
    }
    markBatchCanceled(state.id);
    try {
      clearBatchContent(state);
    } finally {
      clearBatchState();
    }
    showStatus("批量任务已取消", "info");
  }

// --- REPLACED: runBatchStep (状态机与页面对比逻辑) ---
  async function runBatchStep() {
    if (TASK_LOCK.running) return;
    TASK_LOCK.running = true;
    try {
      let state = loadBatchState();
      if (!state) return;

      // 生成当前要探测的 Hash 值
      const hash = state.probeY === 0 ? `#${state.probeX}` : `#${state.probeX}.${state.probeY}`;
      const targetUrl = state.originUrl + hash;

      // 1. 触发 SPA 路由跳转
      if (window.location.hash !== hash) {
          showStatus(`正在跳往嗅探节点 ${hash} ...`, "info");
          window.location.hash = hash;
          // 给 React 一点渲染时间，然后重新触发抓取
          setTimeout(() => { void runBatchStep(); }, 1500);
          return;
      }

      showStatus(`正在提取节点 ${hash} ...`, "info");
      let isValidPage = false;
      let converted = null;

      try {
          // 缩短探测超时时间（因为如果是无效节点，不需要等20秒图表渲染）
          await waitForBatchPageContentReady(4000);
          converted = await convertCurrentPageToMarkdown();
          // 核心判断：这个节点是真的存在，还是被重定向/无视了？
          // 方法：取上一个成功抓取到的节点内容进行查重
          const lastResult = state.results.length > 0 ?
                             loadBatchPageContent(state.id, state.results.length - 1) : null;

          if (converted && converted.markdown.length > 10) {
              // 如果内容和上一页完全一样，说明 SPA 拒绝了跳转，节点不存在
              if (!lastResult || lastResult.content !== converted.markdown) {
                  isValidPage = true;
              }
          }
      } catch (e) {
          isValidPage = false; // 解析报错通常也意味着节点为空
      }

      // 2. 执行状态机分支逻辑
      if (isValidPage && converted) {
          // 节点有效！保存数据
          const cleanTitle = sanitizeFileName(converted.markdownTitle || `Untitled`);
          const displayTitle = `${hash.replace('#', '')}-${cleanTitle}`;

          saveBatchPageContent(state.id, state.results.length, {
              title: displayTitle,
              content: converted.markdown,
              url: targetUrl,
              displayTitle,
              entryPath: `${displayTitle}.md`
          });

          state.results.push({
              index: state.results.length,
              title: displayTitle,
              url: targetUrl,
              displayTitle,
              entryPath: `${displayTitle}.md`
          });

          // 【状态机：成功】
          // 如果当前是 #X，下一步探测 #X.1
          // 如果当前是 #X.Y，下一步探测 #X.(Y+1)
          if (state.probeY === 0) {
              state.probeY = 1;
          } else {
              state.probeY += 1;
          }
      } else {
          // 节点无效！
          // 【状态机：失败】
          if (state.probeY > 0) {
              // 说明 #X 的子节点到底了，切到下一个大章节 #(X+1).0
              state.probeX += 1;
              state.probeY = 0;
          } else {
              // 说明连 #X 大章节都不存在了，所有遍历彻底结束！
              showStatus(`探测到边界 (无 ${hash})，嗅探结束，准备打包！`, "success");
              await finalizeBatch(state);
              return;
          }
      }

      saveBatchState(state);

      if (loadCancelBatchId() === state.id) {
        showStatus("批量任务已取消", "info");
        return;
      }

      // 自动触发下一轮探测
      setTimeout(() => { void runBatchStep(); }, 500);

    } finally {
      TASK_LOCK.running = false;
    }
  }


// --- 在 finalizeBatch 函数中插入这段逻辑 ---
  async function finalizeBatch(state) {
    showStatus("正在处理链接与生成 ZIP...", "info");

    // 1. 构建 [锚点ID -> 文件名] 的映射表
    // 假设 state.results 中每个对象包含 orderParts (数组) 和 entryPath (文件名)
    const hashToFilename = {};
    state.results.forEach(p => {
        if (p.orderParts) {
            // 将 [1, 1] 转换为 "#1.1" 这种形式的 key
            hashToFilename['#' + p.orderParts.join('.')] = p.entryPath;
        }
    });

    let indexContent = `# ${state.folderName}\n\n## 目录索引\n\n`;
    const orderedResults = [...state.results].sort((a, b) => compareOrderParts(a.orderParts, b.orderParts));
    const entries = [];
    const usedEntryPaths = new Set();

    orderedResults.forEach((page) => {
      const stored = loadBatchPageContent(state.id, page.index);
      if (!stored) return;

      // 2. 🌟 核心修复：链接重写逻辑
      // 使用正则查找 (#...) 格式的链接，并尝试将其替换为对应的文件名
      let content = stored.content;
      content = content.replace(/\(#([\d.]+)\)/g, (match, hash) => {
          const targetFilename = hashToFilename['#' + hash];
          // 如果找到了对应的文件，就修改为链接到该文件；否则保持原样
          return targetFilename ? `(${targetFilename})` : match;
      });

      const uniqueEntryPath = ensureUniqueEntryPath(stored.entryPath, usedEntryPaths);
      entries.push({ name: uniqueEntryPath, content: content });
      // 生成 README 索引
      indexContent += `- [${stored.displayTitle}](${uniqueEntryPath})\n`;
    });

    entries.push({ name: "README.md", content: indexContent });
    const zipBlob = await buildZipBlob(entries);
    const zipName = `${state.folderName}.zip`;
    renderDownloadAction(zipBlob, zipName);
    showStatus(`ZIP 已生成`, "success");
    clearBatchContent(state);
    clearBatchState();
    clearCancelBatchId();
  }

  async function resumeBatchTask() {
    try {
      const state = loadBatchState();
      if (!state) {
        return;
      }
      showStatus(
        `检测到未完成批量任务，恢复进度 ${Math.min(state.currentIndex + 1, state.pages.length)}/${state.pages.length}`,
        "info"
      );
      await runBatchStep();
    } catch (error) {
      showStatus(`恢复批量任务失败: ${error.message || String(error)}`, "error");
      console.error("Wiki to Markdown batch resume error:", error);
    }
  }

// --- REPLACED: convertFlowchartSvgToMermaidText (动态坐标系计算 + 中文兼容版) ---
  function convertFlowchartSvgToMermaidText(svgElement) {
      if (!svgElement) return null;
      let mermaidCode = "flowchart TD\n\n";

      const nodes = {};
      const edges = [];
      const clusters = [];

      // 1. 遍历并解析所有节点 (Nodes)
      const nodeElements = svgElement.querySelectorAll('g.node');
      nodeElements.forEach(nodeEl => {
          const svgId = nodeEl.id; // 例如: flowchart-R1-0
          let textContent = "";

          // 提取节点文字
          const textFo = nodeEl.querySelector('.label foreignObject div > span > p, .label foreignObject div > p, .label foreignObject p, .label p, span.nodeLabel p');
          if (textFo) {
              textContent = textFo.textContent.trim().replace(/"/g, '#quot;');
          } else {
              const textElement = nodeEl.querySelector('text, .label text');
              if (textElement) {
                  textContent = textElement.textContent.trim().replace(/"/g, '#quot;');
              }
          }

          // 提取核心 Mermaid ID (例如将 flowchart-R1-0 提取为 R1)
          let mermaidId = svgId.replace(/^flowchart-/, '').replace(/-\d+$/, '');

          // 提取 SVG 绝对坐标 (用于判断它在哪个 subgraph 里面)
          let x = 0, y = 0;
          const transform = nodeEl.getAttribute('transform');
          if (transform) {
              const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
              if (match) {
                  x = parseFloat(match[1]);
                  y = parseFloat(match[2]);
              }
          }

          nodes[mermaidId] = { mermaidId, text: textContent, x, y, clusterId: null };
      });

      // 2. 遍历并解析所有的子图框 (Subgraphs/Clusters)
      const svgClusterElements = svgElement.querySelectorAll('g.cluster');
      svgClusterElements.forEach((clusterEl, index) => {
          const rect = clusterEl.querySelector('rect');
          if (!rect) return;
          const x = parseFloat(rect.getAttribute('x'));
          const y = parseFloat(rect.getAttribute('y'));
          const width = parseFloat(rect.getAttribute('width'));
          const height = parseFloat(rect.getAttribute('height'));

          const labelFo = clusterEl.querySelector('.cluster-label foreignObject div > span > p, .cluster-label foreignObject div > p, .cluster-label foreignObject p, span.nodeLabel p');
          const title = labelFo ? labelFo.textContent.trim() : `Cluster_${index}`;

          // 使用安全的独立 ID，防止中文导致的语法崩溃
          const clusterMermaidId = `subgraph_${index}`;

          clusters.push({
              id: clusterMermaidId,
              title: title,
              x, y, width, height,
              nodeIds: []
          });
      });

      // 3. 碰撞检测：判断节点属于哪个框
      Object.values(nodes).forEach(node => {
          for (const cluster of clusters) {
              // 如果节点的中心坐标落在了 cluster 的矩形范围内
              if (node.x >= cluster.x && node.x <= cluster.x + cluster.width &&
                  node.y >= cluster.y && node.y <= cluster.y + cluster.height) {
                  node.clusterId = cluster.id;
                  cluster.nodeIds.push(node.mermaidId);
                  break;
              }
          }
      });

      // 4. 构建图表代码：先渲染 Subgraphs
      clusters.forEach(cluster => {
          mermaidCode += `    subgraph ${cluster.id} ["${cluster.title}"]\n`;
          cluster.nodeIds.forEach(nodeId => {
              const node = nodes[nodeId];
              mermaidCode += `        ${node.mermaidId}["${node.text}"]\n`;
          });
          mermaidCode += `    end\n\n`;
      });

      // 渲染独立节点（没有被包在框里的）
      Object.values(nodes).forEach(node => {
          if (!node.clusterId) {
              mermaidCode += `    ${node.mermaidId}["${node.text}"]\n`;
          }
      });
      mermaidCode += "\n";

      // 5. 遍历并解析线条关系 (Edges)
      const edgeElements = svgElement.querySelectorAll('path.flowchart-link');
      edgeElements.forEach(edgeEl => {
          const edgeId = edgeEl.id; // 例如: L_E1_E2_0
          if (edgeId && edgeId.startsWith('L_')) {
              const parts = edgeId.split('_');
              if (parts.length >= 3) {
                  let sourceName = parts[1];
                  let targetName = parts[2];

                  // 提取线条上的文字（比如 "入口点"）
                  let edgeText = "";
                  const labelGroup = svgElement.querySelector(`g.label[data-id="${edgeId}"]`);
                  if (labelGroup) {
                      const labelP = labelGroup.querySelector('span.edgeLabel p, span.edgeLabel');
                      if (labelP) {
                          edgeText = labelP.textContent.trim();
                      }
                  }

                  let arrow = "-->";
                  if (edgeText) {
                      arrow = `-- "${edgeText}" -->`;
                  }

                  edges.push(`    ${sourceName} ${arrow} ${targetName}`);
              }
          }
      });

      [...new Set(edges)].forEach(edge => {
          mermaidCode += `${edge}\n`;
      });

      if (Object.keys(nodes).length === 0 && edges.length === 0 && clusters.length === 0) return null;

      return '```mermaid\n' + mermaidCode.trim() + '\n```';
  }

  function convertClassDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;
    const mermaidLines = ['classDiagram'];
    const classData = {};
    svgElement.querySelectorAll('g.node.default').forEach(node => {
      const classIdSvg = node.getAttribute('id');
      if (!classIdSvg) return;
      const classNameMatch = classIdSvg.match(/^classId-([^-]+(?:-[^-]+)*)-(\d+)$/);
      if (!classNameMatch) return;
      const className = classNameMatch[1];
      if (!classData[className]) {
        classData[className] = { stereotype: "", members: [], methods: [] };
      }
      const stereotypeElem = node.querySelector('g.annotation-group.text foreignObject span.nodeLabel p, g.annotation-group.text foreignObject div p');
      if (stereotypeElem && stereotypeElem.textContent.trim()) {
        classData[className].stereotype = stereotypeElem.textContent.trim();
      }
      node.querySelectorAll('g.members-group.text g.label foreignObject span.nodeLabel p, g.members-group.text g.label foreignObject div p').forEach(m => {
        const txt = m.textContent.trim();
        if (txt) classData[className].members.push(txt);
      });
      node.querySelectorAll('g.methods-group.text g.label foreignObject span.nodeLabel p, g.methods-group.text g.label foreignObject div p').forEach(m => {
        const txt = m.textContent.trim();
        if (txt) classData[className].methods.push(txt);
      });
    });
    for (const className in classData) {
      const data = classData[className];
      if (data.stereotype) {
        mermaidLines.push(`    class ${className} {`);
        mermaidLines.push(`        ${data.stereotype}`);
      } else {
        mermaidLines.push(`    class ${className} {`);
      }
      data.members.forEach(member => { mermaidLines.push(`        ${member}`); });
      data.methods.forEach(method => { mermaidLines.push(`        ${method}`); });
      mermaidLines.push('    }');
    }
    const pathElements = Array.from(svgElement.querySelectorAll('path.relation[id^="id_"]'));
    const labelElements = Array.from(svgElement.querySelectorAll('g.edgeLabels .edgeLabel foreignObject p'));
    pathElements.forEach((path, index) => {
      const id = path.getAttribute('id');
      const parts = id.split('_');
      if (parts.length < 3) return;
      const fromClass = parts[1];
      const toClass = parts[2];
      const markerEndAttr = path.getAttribute('marker-end') || "";
      let relationshipType = "";
      const lineStyle = path.classList.contains('dashed-line') ? ".." :
        path.classList.contains('dotted-line') ? "." : "--";
      if (markerEndAttr.includes('extensionEnd')) {
        relationshipType = `${toClass} <|${lineStyle} ${fromClass}`;
      } else if (markerEndAttr.includes('compositionEnd')) {
        relationshipType = `${fromClass} *${lineStyle} ${toClass}`;
      } else if (markerEndAttr.includes('aggregationEnd')) {
        relationshipType = `${fromClass} o${lineStyle} ${toClass}`;
      } else if (markerEndAttr.includes('lollipopEnd')) {
        relationshipType = `${fromClass} ..|> ${toClass}`;
      } else if (markerEndAttr.includes('dependencyEnd')) {
        relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
      } else {
        relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
        if (lineStyle === "--" && !markerEndAttr.includes('End')) {
          relationshipType = `${fromClass} -- ${toClass}`;
        }
      }
      const labelText = (labelElements[index] && labelElements[index].textContent) ? labelElements[index].textContent.trim() : "";
      if (relationshipType) {
        mermaidLines.push(`    ${relationshipType}${labelText ? ' : ' + labelText : ''}`);
      }
    });
    if (mermaidLines.length <= 1 && Object.keys(classData).length === 0) return null;
    return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
  }

  function convertSequenceDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;
    const participants = [];
    const actorXCoordinates = new Map();
    svgElement.querySelectorAll('line.actor-line').forEach(line => {
      const name = line.getAttribute('name');
      const xPos = parseFloat(line.getAttribute('x1'));
      if (name && !isNaN(xPos) && !actorXCoordinates.has(name)) {
        participants.push({ name: name, x: xPos, alias: name.replace(/[^a-zA-Z0-9_]/g, '_') });
        actorXCoordinates.set(name, xPos);
      }
    });
    svgElement.querySelectorAll('g[id^="root-"] > text.actor-box').forEach((textEl, index) => {
      const parentGroup = textEl.closest('g[id^="root-"]');
      const rectName = parentGroup?.querySelector('rect.actor-top')?.getAttribute('name');
      const name = rectName || textEl.textContent.trim();
      if (name && !actorXCoordinates.has(name)) {
        let xPos = parseFloat(textEl.getAttribute('x'));
        const correspondingLine = svgElement.querySelector(`line.actor-line[name="${name}"]`);
        if (correspondingLine) {
          xPos = parseFloat(correspondingLine.getAttribute('x1'));
        }
        if (!isNaN(xPos)) {
          participants.push({ name: name, x: xPos, alias: name.replace(/[^a-zA-Z0-9_]/g, '_') });
          actorXCoordinates.set(name, xPos);
        }
      }
    });
    const uniqueParticipants = [];
    const seenNames = new Set();
    participants.filter(p => p.name && !isNaN(p.x)).forEach(p => {
      if (!seenNames.has(p.name)) {
        uniqueParticipants.push(p);
        seenNames.add(p.name);
      }
    });
    uniqueParticipants.sort((a, b) => a.x - b.x);
    let mermaidOutput = "sequenceDiagram\n";
    uniqueParticipants.forEach(p => {
      if (p.alias !== p.name) {
        mermaidOutput += `  participant ${p.alias} as "${p.name}"\n`;
      } else {
        mermaidOutput += `  participant ${p.name}\n`;
      }
    });
    mermaidOutput += "\n";
    const events = [];
    const messageLineElements = Array.from(svgElement.querySelectorAll('line[class^="messageLine"]'));
    const messageTextElements = Array.from(svgElement.querySelectorAll('text.messageText'));
    messageLineElements.forEach((lineEl, index) => {
      const x1 = parseFloat(lineEl.getAttribute('x1'));
      const y1 = parseFloat(lineEl.getAttribute('y1'));
      const x2 = parseFloat(lineEl.getAttribute('x2'));
      let fromActorName = null;
      let toActorName = null;
      let minDiffFrom = Infinity;
      let minDiffTo = Infinity;
      uniqueParticipants.forEach(p => {
        const diff1 = Math.abs(p.x - x1);
        if (diff1 < minDiffFrom) {
          minDiffFrom = diff1;
          fromActorName = p.alias;
        }
        const diff2 = Math.abs(p.x - x2);
        if (diff2 < minDiffTo) {
          minDiffTo = diff2;
          toActorName = p.alias;
        }
      });
      let eventY = y1;
      let textContent = "";
      if (messageTextElements[index]) {
        textContent = messageTextElements[index].textContent.trim().replace(/"/g, '#quot;');
        const textY = parseFloat(messageTextElements[index].getAttribute('y'));
        if (!isNaN(textY)) eventY = textY;
      }
      const lineClass = lineEl.getAttribute('class') || "";
      const arrowType = lineClass.includes('messageLine1') ? '-->' : '->';
      if (fromActorName && toActorName) {
        events.push({
          y: eventY,
          type: 'message',
          data: {
            from: fromActorName,
            to: toActorName,
            arrow: arrowType,
            text: textContent
          }
        });
      }
    });
    svgElement.querySelectorAll('g > rect.note').forEach(noteRect => {
      const rectY = parseFloat(noteRect.getAttribute('y'));
      const noteX = parseFloat(noteRect.getAttribute('x'));
      const noteWidth = parseFloat(noteRect.getAttribute('width'));
      let noteTextContent = "Note";
      const noteTextElement = noteRect.parentElement.querySelector('text.noteText');
      if (noteTextElement) {
        noteTextContent = Array.from(noteTextElement.querySelectorAll('tspan'))
          .map(tspan => tspan.textContent.trim())
          .join(' ') ||
          noteTextElement.textContent.trim();
        noteTextContent = noteTextContent.replace(/"/g, '#quot;');
      }
      let noteMermaidData = { text: noteTextContent };
      let placementDetermined = false;
      const coveredParticipants = uniqueParticipants.filter(p => {
        const participantBoxStartX = p.x - 75;
        const participantBoxEndX = p.x + 75;
        return Math.max(noteX, participantBoxStartX) < Math.min(noteX + noteWidth, participantBoxEndX);
      });
      if (coveredParticipants.length > 1) {
        coveredParticipants.sort((a, b) => a.x - b.x);
        noteMermaidData.position = 'over';
        noteMermaidData.actor1 = coveredParticipants[0].alias;
        noteMermaidData.actor2 = coveredParticipants[coveredParticipants.length - 1].alias;
        placementDetermined = true;
      } else if (coveredParticipants.length === 1) {
        noteMermaidData.position = 'over';
        noteMermaidData.actor1 = coveredParticipants[0].alias;
        placementDetermined = true;
      }
      if (!placementDetermined) {
        let closestParticipant = null;
        let minDistToClosest = Infinity;
        uniqueParticipants.forEach(p => {
          const dist = Math.abs(p.x - (noteX + noteWidth / 2));
          if (dist < minDistToClosest) {
            minDistToClosest = dist;
            closestParticipant = p;
          }
        });
        if (closestParticipant) {
          if (noteX + noteWidth < closestParticipant.x - 10) {
            noteMermaidData.position = 'left of';
            noteMermaidData.actor1 = closestParticipant.alias;
          } else if (noteX > closestParticipant.x + 10) {
            noteMermaidData.position = 'right of';
            noteMermaidData.actor1 = closestParticipant.alias;
          } else {
            noteMermaidData.position = 'over';
            noteMermaidData.actor1 = closestParticipant.alias;
          }
          placementDetermined = true;
        }
      }
      if (placementDetermined && noteMermaidData.actor1) {
        events.push({
          y: rectY,
          type: 'note',
          data: noteMermaidData
        });
      }
    });
    events.sort((a, b) => a.y - b.y);
    events.forEach(event => {
      if (event.type === 'message') {
        const m = event.data;
        mermaidOutput += `  ${m.from}${m.arrow}${m.to}: ${m.text}\n`;
      } else if (event.type === 'note') {
        const n = event.data;
        if (n.position === 'over' && n.actor2) {
          mermaidOutput += `  Note over ${n.actor1},${n.actor2}: ${n.text}\n`;
        } else {
          mermaidOutput += `  Note ${n.position} ${n.actor1}: ${n.text}\n`;
        }
      }
    });
    if (uniqueParticipants.length === 0 && events.length === 0) return null;
    return '```mermaid\n' + mermaidOutput.trim() + '\n```';
  }

  function processNode(node) {
    let resultMd = "";
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentNode && node.parentNode.nodeName === 'PRE') {
        return node.textContent;
      }
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    const style = window.getComputedStyle(element);
    if (
      (style.display === "none" || style.visibility === "hidden") &&
      !["DETAILS", "SUMMARY"].includes(element.nodeName)
    ) {
      return "";
    }
    if (element.matches('button, [role="button"], nav, footer, aside, script, style, noscript, iframe, embed, object, header')) {
      return "";
    }
    if (element.classList.contains("bg-input-dark") && element.querySelector("svg")) {
      return "";
    }
    try {
      switch (element.nodeName) {
        case "P": {
          let txt = "";
          element.childNodes.forEach((c) => {
            try { txt += processNode(c); } catch (e) { console.error("Error processing child of P:", c, e); txt += "[err]"; }
          });
          txt = txt.trim();
          if (txt.startsWith("```mermaid") && txt.endsWith("```")) {
            resultMd = txt + "\n\n";
          } else if (txt) {
            resultMd = txt + "\n\n";
          } else {
            resultMd = "\n";
          }
          break;
        }
          case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
          // 提取干净的文本，过滤掉 Devin 特有的 "Link copied!" 等隐藏交互文字
          let rawText = element.textContent || "";
          let cleanText = rawText
              .replace(/Link copied!/ig, '') // 删掉复制提示
              .replace(/^#\s*/, '')          // 删掉可能附带的锚点井号图标
              .trim();

          if (!cleanText) {
              resultMd = "";
              break;
          }
          // 根据标签名 (H1->1, H2->2) 动态生成对应数量的 '#'
          const level = parseInt(element.nodeName.substring(1), 10);
          const hashes = "#".repeat(level);
          resultMd = `${hashes} ${cleanText}\n\n`;
          break;
        }
        case "UL": {
          let list = "";
          element.querySelectorAll(":scope > li").forEach((li) => {
            let liTxt = "";
            li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]"; } });
            liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
            if (liTxt) list += `* ${liTxt}\n`;
          });
          resultMd = list + (list ? "\n" : "");
          break;
        }
        case "OL": {
          let list = "";
          let i = 1;
          element.querySelectorAll(":scope > li").forEach((li) => {
            let liTxt = "";
            li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]"; } });
            liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
            if (liTxt) {
              list += `${i}. ${liTxt}\n`;
              i++;
            }
          });
          resultMd = list + (list ? "\n" : "");
          break;
        }
        case "PRE": {
          const svgElement = getDiagramSvgInPre(element);
          let mermaidOutput = null;
          if (svgElement) {
            const diagramTypeDesc = (svgElement.getAttribute('aria-roledescription') || '').toLowerCase();
            const diagramClass = (svgElement.getAttribute('class') || '').toLowerCase();
            if (diagramTypeDesc.includes('flowchart')) {
              mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
            } else if (diagramTypeDesc.includes('class')) {
              mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
            } else if (diagramTypeDesc.includes('sequence')) {
              mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
            } else if (diagramClass.includes('flowchart')) {
              mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
            } else if (diagramClass.includes('classdiagram') || diagramClass.includes('class')) {
              mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
            } else if (diagramClass.includes('sequencediagram') || diagramClass.includes('sequence')) {
              mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
            } else {
              mermaidOutput =
                convertFlowchartSvgToMermaidText(svgElement) ||
                convertClassDiagramSvgToMermaidText(svgElement) ||
                convertSequenceDiagramSvgToMermaidText(svgElement);
            }
          }
          if (mermaidOutput) {
            resultMd = `\n${mermaidOutput}\n\n`;
          } else {
            const code = element.querySelector("code");
            const codeText = (code?.textContent || "").trim();
            if (svgElement && !codeText) {
              const svgMarkup = svgElement.outerHTML || "";
              if (svgMarkup.trim()) {
                resultMd = `\n\`\`\`html\n${svgMarkup}\n\`\`\`\n\n`;
                break;
              }
            }
            let lang = "";
            let txt = "";
            if (code) {
              txt = code.textContent;
              const cls = Array.from(code.classList).find((c) => c.startsWith("language-"));
              if (cls) lang = cls.replace("language-", "");
            } else {
              txt = element.textContent;
            }
            const trimmedText = txt.trim();
            if (!trimmedText) {
              resultMd = "\n";
              break;
            }
            if (/^```mermaid[\s\S]*```$/.test(trimmedText)) {
              resultMd = `${trimmedText}\n\n`;
              break;
            }
            if (!lang) {
              const preCls = Array.from(element.classList).find((c) => c.startsWith("language-"));
              if (preCls) lang = preCls.replace("language-", "");
            }
            resultMd = `\`\`\`${lang}\n${trimmedText}\n\`\`\`\n\n`;
          }
          break;
        }
        case "A": {
          const href = element.getAttribute("href");
          let text = "";
          element.childNodes.forEach(c => {
            try {
              text += processNode(c);
            } catch (e) {
              console.error("Error processing child of A:", c, e);
              text += "[err]";
            }
          });
          // 🌟 核心修复：强制将链接文本中的所有换行符（及周围空格）替换为单个空格
          // 这样 "application.yaml\n#49-87" 就会变成合法的 "application.yaml #49-87"
          text = text.trim().replace(/\s*\n+\s*/g, ' ');
          if (!text && element.querySelector('img')) {
            text = element.querySelector('img').alt || 'image';
          }
          text = text || (href ? href : "");
          if (href && (href.startsWith('http') || href.startsWith('https') || href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:'))) {
            const hashMatch = href.match(/#L(\d+)-L(\d+)$/);
            if (hashMatch) {
              const hashStartLine = hashMatch[1];
              const hashEndLine = hashMatch[2];
              const textMatch = text.match(/^([\w\/-]+(?:\.\w+)?)\s+(\d+)-(\d+)$/);
              if (textMatch) {
                const textFilename = textMatch[1];
                const textStartLine = textMatch[2];
                const textEndLine = textMatch[3];
                if (hashStartLine === textStartLine && hashEndLine === textEndLine) {
                  const pathPart = href.substring(0, href.indexOf('#'));
                  if (pathPart.endsWith('/' + textFilename) || pathPart.includes('/' + textFilename) || pathPart === textFilename) {
                    text = `${textFilename} L${hashStartLine}-L${hashEndLine}`;
                  }
                }
              } else {
                const sourcesMatch = text.match(/^Sources:\s+\[([\w\/-]+(?:\.\w+)?)\s+(\d+)-(\d+)\]$/);
                if (sourcesMatch) {
                  const textFilename = sourcesMatch[1];
                  const textStartLine = sourcesMatch[2];
                  const textEndLine = sourcesMatch[3];
                  if (hashStartLine === textStartLine && hashEndLine === textEndLine) {
                    const pathPart = href.substring(0, href.indexOf('#'));
                    if (pathPart.endsWith('/' + textFilename) || pathPart.includes('/' + textFilename) || pathPart === textFilename) {
                      text = `Sources: [${textFilename} L${hashStartLine}-L${hashEndLine}]`;
                    }
                  }
                }
              }
            }
            resultMd = `[${text}](${href})`;
            if (window.getComputedStyle(element).display !== "inline") {
              resultMd += "\n\n";
            }
          } else {
            resultMd = text;
            if (window.getComputedStyle(element).display !== "inline" && text.trim()) {
              resultMd += "\n\n";
            }
          }
          break;
        }
case "IMG":
          if (element.closest && element.closest('a')) return "";
          resultMd = (element.src ? `![${element.alt || ""}](${element.src})\n\n` : "");
          break;
        // 🌟 新增：紧急拦截 SVG 架构图，防止被压扁成纯文本
        case "svg":
        case "SVG": {
          // 判断它到底是不是真正的图表，还是只是页面上的一个小 UI 图标
          if (isDiagramSvgCandidate(element) || element.id.startsWith("mermaid-") || element.classList.contains("mermaid")) {
            let mermaidOutput = null;
            const role = (element.getAttribute('aria-roledescription') || '').toLowerCase();
            const cls = (element.getAttribute('class') || '').toLowerCase();
            // 尝试逆向工程，把 SVG 还原为 Mermaid 代码
            if (role.includes('flowchart') || cls.includes('flowchart')) {
              mermaidOutput = convertFlowchartSvgToMermaidText(element);
            } else if (role.includes('class') || cls.includes('classdiagram') || cls.includes('class')) {
              mermaidOutput = convertClassDiagramSvgToMermaidText(element);
            } else if (role.includes('sequence') || cls.includes('sequencediagram') || cls.includes('sequence')) {
              mermaidOutput = convertSequenceDiagramSvgToMermaidText(element);
            } else {
              mermaidOutput = convertFlowchartSvgToMermaidText(element) ||
                              convertClassDiagramSvgToMermaidText(element) ||
                              convertSequenceDiagramSvgToMermaidText(element);
            }
            if (mermaidOutput) {
              resultMd = `\n${mermaidOutput}\n\n`;
            } else {
              // 如果逆向失败（比如 Devin 加了超链接太复杂），直接把 SVG 原样塞进 Markdown！
              // 主流 Markdown 编辑器（Typora/Obsidian）都能完美渲染原生 HTML SVG。
              resultMd = `\n\`\`\`html\n${element.outerHTML}\n\`\`\`\n\n`;
            }
          } else {
            // 普通的 UI 小图标（比如复制按钮）直接忽略，防止产出垃圾代码
            resultMd = "";
          }
          break;
        }
        case "BLOCKQUOTE": {
          let qt = "";
          element.childNodes.forEach((c) => { try { qt += processNode(c); } catch (e) { console.error("Error processing child of BLOCKQUOTE:", c, e); qt += "[err]"; } });
          const trimmedQt = qt.trim();
          if (trimmedQt) {
            resultMd = trimmedQt.split("\n").map((l) => `> ${l.trim() ? l : ''}`).filter(l => l.trim() !== '>').join("\n") + "\n\n";
          } else {
            resultMd = "";
          }
          break;
        }
        case "HR":
          resultMd = "\n---\n\n";
          break;
        case "STRONG":
        case "B": {
          let st = "";
          element.childNodes.forEach((c) => { try { st += processNode(c); } catch (e) { console.error("Error processing child of STRONG/B:", c, e); st += "[err]"; } });
          return `**${st.trim()}**`;
        }
        case "EM":
        case "I": {
          let em = "";
          element.childNodes.forEach((c) => { try { em += processNode(c); } catch (e) { console.error("Error processing child of EM/I:", c, e); em += "[err]"; } });
          return `*${em.trim()}*`;
        }
        case "CODE": {
          if (element.parentNode && element.parentNode.nodeName === 'PRE') {
            return element.textContent;
          }
          return `\`${element.textContent.trim()}\``;
        }
        case "BR":
          if (element.parentNode && ['P', 'DIV', 'LI'].includes(element.parentNode.nodeName)) {
            const nextSibling = element.nextSibling;
            if (!nextSibling || (nextSibling.nodeType === Node.TEXT_NODE && nextSibling.textContent.trim() !== '') || nextSibling.nodeType === Node.ELEMENT_NODE) {
              return "  \n";
            }
          }
          return "";
        case "TABLE": {
          let tableMd = "";
          const headerRows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tr:first-child'));
          const bodyRows = Array.from(element.querySelectorAll(':scope > tbody > tr'));
          const allRows = Array.from(element.rows);
          let rowsToProcessForHeader = headerRows;
          if (headerRows.length === 0 && allRows.length > 0) {
            rowsToProcessForHeader = [allRows[0]];
          }
          if (rowsToProcessForHeader.length > 0) {
            const headerRowElement = rowsToProcessForHeader[0];
            let headerContent = "|"; let separator = "|";
            Array.from(headerRowElement.cells).forEach(cell => {
              let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Header):", c, e); cellText += "[err]"; } });
              headerContent += ` ${cellText.trim().replace(/\|/g, "\\|")} |`; separator += ` --- |`;
            });
            tableMd += `${headerContent}\n${separator}\n`;
          }
          let rowsToProcessForBody = bodyRows;
          if (bodyRows.length === 0 && allRows.length > (headerRows.length > 0 ? 1 : 0)) {
            rowsToProcessForBody = headerRows.length > 0 ? allRows.slice(1) : allRows;
          }
          rowsToProcessForBody.forEach(row => {
            if (rowsToProcessForHeader.length > 0 && rowsToProcessForHeader.includes(row)) return;
            let rowContent = "|";
            Array.from(row.cells).forEach(cell => {
              let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Body):", c, e); cellText += "[err]"; } });
              rowContent += ` ${cellText.trim().replace(/\|/g, "\\|").replace(/\n+/g, ' <br> ')} |`;
            });
            tableMd += `${rowContent}\n`;
          });
          resultMd = tableMd + (tableMd ? "\n" : "");
          break;
        }
        case "THEAD": case "TBODY": case "TFOOT": case "TR": case "TH": case "TD":
          return "";
        case "DETAILS": {
          let summaryText = "Details";
          const summaryElem = element.querySelector('summary');
          if (summaryElem) {
            let tempSummary = "";
            summaryElem.childNodes.forEach(c => { try { tempSummary += processNode(c); } catch (e) { console.error("Error processing child of SUMMARY:", c, e); tempSummary += "[err]"; } });
            summaryText = tempSummary.trim() || "Details";
          }
          let detailsContent = "";
          Array.from(element.childNodes).forEach(child => { if (child.nodeName !== "SUMMARY") { try { detailsContent += processNode(child); } catch (e) { console.error("Error processing child of DETAILS:", child, e); detailsContent += "[err]"; } } });
          resultMd = `> **${summaryText}**\n${detailsContent.trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
          break;
        }
        case "SUMMARY": return "";
        case "DIV":
        case "SPAN":
        case "SECTION":
        case "ARTICLE":
        case "MAIN":
        default: {
          let txt = "";
          element.childNodes.forEach((c) => { try { txt += processNode(c); } catch (e) { console.error("Error processing child of DEFAULT case:", c, element.nodeName, e); txt += "[err]"; } });
          const d = window.getComputedStyle(element);
          const isBlock = ["block", "flex", "grid", "list-item", "table", "table-row-group", "table-header-group", "table-footer-group"].includes(d.display);
          if (isBlock && txt.trim()) {
            if (txt.endsWith('\n\n')) {
              resultMd = txt;
            } else if (txt.endsWith('\n')) {
              resultMd = txt + '\n';
            } else {
              resultMd = txt.trimEnd() + "\n\n";
            }
          } else {
            return txt;
          }
        }
      }
    } catch (error) {
      console.error("Unhandled error in processNode for element:", element.nodeName, element, error);
      return `\n[ERROR_PROCESSING_ELEMENT: ${element.nodeName}]\n\n`;
    }
    return resultMd;
  }

  function bootstrap() {
    mountPanel();
    registerMenuCommands();
    void resumeBatchTask();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
