const { chromium } = require("playwright");

const PROFILE_URL =
  process.env.SMT_PROFILE_URL ||
  "https://www.binance.com/en-TR/smart-money/profile/5042407904790565889";

const SCRAPE_INTERVAL_MS = parseInt(process.env.SMT_INTERVAL_MS || "8000", 10);
const NAV_RETRY_DELAY_MS = 15000;

// This function runs INSIDE the headless browser page (page.evaluate),
// reusing the exact selector logic validated in the extension's content.js.
function extractPageData() {
  function textOf(el) {
    return el ? el.textContent.trim() : "";
  }

  function parseNumber(str) {
    if (!str) return null;
    const cleaned = str.replace(/[^0-9.+-]/g, "");
    const value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  function findPositionCards() {
    const symbolNodes = Array.from(
      document.querySelectorAll("div.bn-flex.t-subtitle1.md\\:t-subtitle6.text-PrimaryText")
    );
    const cards = [];
    for (const symbolNode of symbolNodes) {
      const card = symbolNode.closest("div.bn-flex.flex-col");
      if (!card || cards.some((c) => c.card === card)) continue;
      cards.push({ card, symbolNode });
    }
    return cards;
  }

  function extractPosition(card, symbolNode) {
    const symbol = textOf(symbolNode);
    if (!symbol) return null;

    const sideBadge = textOf(card.querySelector("div.bn-flex.size-\\[16px\\]"));
    const side = sideBadge === "S" ? "SHORT" : sideBadge === "L" ? "LONG" : "UNKNOWN";

    const tagNodes = Array.from(card.querySelectorAll(".bn-bubble-content")).map((n) =>
      textOf(n)
    );
    const leverageTag = tagNodes.find((t) => /x$/i.test(t)) || "";
    const marginModeTag = tagNodes.find((t) => /cross|isolated/i.test(t)) || "";

    const captionNodes = Array.from(card.querySelectorAll(".t-caption1.text-SecondaryText"));
    const fieldByLabel = {};
    for (const cap of captionNodes) {
      const label = textOf(cap);
      const valueNode =
        cap.parentElement && cap.parentElement.querySelector(".t-subtitle1, .t-subtitle2");
      fieldByLabel[label] = textOf(valueNode);
    }

    const pnlRaw = fieldByLabel["PnL (USDT)"] || "";
    const roiRaw = fieldByLabel["ROI"] || "";
    const sizeRaw = fieldByLabel["Size"] || "";
    const marginRaw = fieldByLabel["Margin (USDT)"] || "";
    const marginRatioRaw = fieldByLabel["Margin Ratio"] || "";
    const entryRaw = fieldByLabel["Entry Price (USDT)"] || "";
    const markRaw = fieldByLabel["Mark Price (USDT)"] || "";
    const liqRaw = fieldByLabel["Liq.Price (USDT)"] || "";

    return {
      symbol,
      side,
      leverage: leverageTag,
      marginMode: marginModeTag,
      pnlUsd: parseNumber(pnlRaw),
      pnlRaw,
      roiPct: parseNumber(roiRaw),
      sizeRaw,
      marginUsd: parseNumber(marginRaw),
      marginRatioPct: parseNumber(marginRatioRaw),
      entryPrice: parseNumber(entryRaw),
      markPrice: parseNumber(markRaw),
      liqPrice: parseNumber(liqRaw)
    };
  }

  function readTotalMarginBalance() {
    const statRows = Array.from(
      document.querySelectorAll("div.bn-flex.flex-col.md\\:flex-row.md\\:justify-between")
    );
    for (const row of statRows) {
      const label = row.querySelector(".t-caption1.text-SecondaryText");
      const value = row.querySelector(".t-subtitle2.text-PrimaryText");
      if (label && value && /Total Margin Balance/i.test(textOf(label))) {
        return parseNumber(textOf(value));
      }
    }
    const allDivs = Array.from(document.querySelectorAll("div"));
    const labelNode = allDivs.find(
      (el) =>
        el.children.length === 0 &&
        /^Total Margin Balance/i.test((el.textContent || "").trim())
    );
    if (!labelNode) return null;
    const row = labelNode.closest("div.bn-flex");
    if (row) {
      const valueNode = row.querySelector(".t-subtitle2");
      if (valueNode) {
        const n = parseNumber(textOf(valueNode));
        if (n != null) return n;
      }
    }
    return null;
  }

  const cards = findPositionCards();
  const positions = cards
    .map(({ card, symbolNode }) => extractPosition(card, symbolNode))
    .filter(Boolean);
  const totalMarginBalance = readTotalMarginBalance();

  return { positions, totalMarginBalance };
}

class BinanceScraper {
  constructor({ onUpdate, onStatus }) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.running = false;
    this.timer = null;
  }

  async start() {
    this.running = true;
    await this._launch();
    this._scheduleLoop();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.browser) await this.browser.close().catch(() => {});
  }

  async _launch() {
    this._status("LAUNCHING", "Headless tarayıcı başlatılıyor...");
    this.browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    this.context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 1200 },
      locale: "en-US"
    });
    this.page = await this.context.newPage();
    await this._navigate();
  }

  async _navigate() {
    this._status("NAVIGATING", "Profil sayfasına gidiliyor...");
    try {
      await this.page.goto(PROFILE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await this.page.waitForTimeout(3500);
      this._status("CONNECTED", "Sayfa yüklendi, izleme başladı.");
    } catch (err) {
      this._status("NAV_ERROR", `Sayfa yüklenemedi: ${err.message}`);
      throw err;
    }
  }

  _scheduleLoop() {
    if (!this.running) return;
    this.timer = setTimeout(() => this._tick(), SCRAPE_INTERVAL_MS);
  }

  async _tick() {
    if (!this.running) return;
    try {
      const data = await this.page.evaluate(extractPageData);
      this.onUpdate(data);
      this._status("CONNECTED", null);
    } catch (err) {
      this._status("SCRAPE_ERROR", `Okuma hatası: ${err.message}`);
      const recovered = await this._tryRecover();
      if (!recovered) {
        await this._fullRestart();
      }
    }
    this._scheduleLoop();
  }

  async _tryRecover() {
    try {
      await this.page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
      await this.page.waitForTimeout(3000);
      this._status("CONNECTED", "Sayfa yeniden yüklendi.");
      return true;
    } catch {
      return false;
    }
  }

  async _fullRestart() {
    this._status("RESTARTING", "Tarayıcı yeniden başlatılıyor...");
    try {
      if (this.browser) await this.browser.close().catch(() => {});
    } finally {
      await new Promise((r) => setTimeout(r, NAV_RETRY_DELAY_MS));
      try {
        await this._launch();
      } catch (err) {
        this._status("FATAL", `Yeniden başlatma başarısız: ${err.message}`);
      }
    }
  }

  _status(state, message) {
    if (this.onStatus) this.onStatus({ state, message, ts: Date.now() });
  }
}

module.exports = { BinanceScraper, PROFILE_URL, SCRAPE_INTERVAL_MS };
