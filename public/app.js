const VAULT_USD = 1000;

const els = {
  connDot: document.getElementById("connDot"),
  connLabel: document.getElementById("connLabel"),
  vaultUsedPct: document.getElementById("vaultUsedPct"),
  vaultUsedUsd: document.getElementById("vaultUsedUsd"),
  traderBalance: document.getElementById("traderBalance"),
  openCount: document.getElementById("openCount"),
  lastUpdateFoot: document.getElementById("lastUpdateFoot"),
  positionList: document.getElementById("positionList"),
  positionsEmpty: document.getElementById("positionsEmpty"),
  historyList: document.getElementById("historyList"),
  historyEmpty: document.getElementById("historyEmpty"),
  toastStack: document.getElementById("toastStack"),
  tabs: document.querySelectorAll(".tab"),
  positionsPanel: document.getElementById("positionsPanel"),
  historyPanel: document.getElementById("historyPanel"),
  statusMessage: document.getElementById("statusMessage"),
  serverTime: document.getElementById("serverTime")
};

let knownKeys = new Set();
let ws = null;
let reconnectDelay = 1000;

function fmtUsd(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

function positionKey(p) {
  return `${p.symbol}_${p.side}`;
}

function traderVaultUsePct(position, totalMarginBalance) {
  if (!position.marginUsd || !totalMarginBalance) return null;
  return (position.marginUsd / totalMarginBalance) * 100;
}

function myEntryUsd(vaultUsePct) {
  if (vaultUsePct == null) return null;
  return (vaultUsePct / 100) * VAULT_USD;
}

function donutSvg(pct, id) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return `
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="${radius}" fill="none" stroke="#1d2430" stroke-width="5"/>
      <circle cx="28" cy="28" r="${radius}" fill="none" stroke="url(#grad-${id})" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        transform="rotate(-90 28 28)" style="transition: stroke-dashoffset 0.6s ease"/>
      <defs>
        <linearGradient id="grad-${id}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00f0d8"/>
          <stop offset="100%" stop-color="#ff2e88"/>
        </linearGradient>
      </defs>
    </svg>
  `;
}

function buildPositionCard(position, totalMarginBalance, opts = {}) {
  const key = positionKey(position);
  const sideClass = position.side === "SHORT" ? "side-short" : "side-long";
  const sideChipClass = position.side === "SHORT" ? "short" : "long";
  const pnlClass = (position.pnlUsd ?? 0) >= 0 ? "up" : "down";
  const vaultPct = traderVaultUsePct(position, totalMarginBalance);
  const entryUsd = myEntryUsd(vaultPct);
  const donutId = key.replace(/[^a-zA-Z0-9]/g, "");

  const card = document.createElement("div");
  card.className = `pos-card ${sideClass}${opts.closed ? " closed" : ""}`;
  card.dataset.key = key;

  card.innerHTML = `
    <div class="pos-head">
      <div class="pos-symbol-wrap">
        <span class="side-chip ${sideChipClass}">${position.side === "SHORT" ? "S" : "L"}</span>
        <span class="pos-symbol">${position.symbol}</span>
        <span class="pos-lev">${position.leverage || ""} ${position.marginMode || ""}</span>
      </div>
      <span class="pos-pnl ${pnlClass}">${position.pnlRaw || fmtUsd(position.pnlUsd)}</span>
    </div>
    <div class="pos-body">
      <div class="pos-donut-wrap">
        ${donutSvg(vaultPct, donutId)}
        <span class="pos-donut-pct">${vaultPct != null ? vaultPct.toFixed(1) + "%" : "—"}</span>
      </div>
      <div class="pos-metrics">
        <div class="metric-line"><span>Giriş / Mark</span><span>${fmtUsd(position.entryPrice, 2)} → ${fmtUsd(position.markPrice, 2)}</span></div>
        <div class="metric-line"><span>Margin / Likidasyon</span><span>$${fmtUsd(position.marginUsd)} · ${fmtUsd(position.liqPrice, 2)}</span></div>
        <div class="metric-line"><span>ROI</span><span>${fmtPct(position.roiPct)}</span></div>
        <div class="my-entry-line">
          <span class="my-entry-label">Benim Giriş Tutarım</span>
          <span class="my-entry-value">$${entryUsd != null ? fmtUsd(entryUsd) : "—"}</span>
        </div>
        <div class="trader-vault-use">Trader Kasa Kullanımı: ${vaultPct != null ? vaultPct.toFixed(1) + "%" : "—"}</div>
        ${opts.closed ? `<div class="pos-closed-tag">⨯ POZİSYON KAPANDI</div>` : ""}
      </div>
    </div>
  `;
  return card;
}

function showToast(type, position) {
  const toast = document.createElement("div");
  const cls = type === "OPEN" ? "" : type === "CLOSE" ? "toast-close" : "toast-update";
  toast.className = `toast ${cls}`;
  const title =
    type === "OPEN" ? "▲ YENİ POZİSYON AÇILDI" : type === "CLOSE" ? "▼ POZİSYON KAPANDI" : "● POZİSYON GÜNCELLENDİ";
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-body">
      <span class="toast-symbol">${position.symbol}</span>
      <span>${position.side} ${position.leverage || ""}</span>
    </div>
  `;
  els.toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 4700);
}

function renderPositions(state) {
  const positions = Object.values(state.openPositions || {});
  els.positionList.innerHTML = "";

  if (positions.length === 0) {
    els.positionsEmpty.style.display = "flex";
  } else {
    els.positionsEmpty.style.display = "none";
    for (const p of positions) {
      const card = buildPositionCard(p, state.totalMarginBalance);
      if (!knownKeys.has(positionKey(p))) {
        card.classList.add("flash-in");
      }
      els.positionList.appendChild(card);
    }
  }

  knownKeys = new Set(positions.map(positionKey));
  els.openCount.textContent = positions.length;

  const totalEntryUsd = positions.reduce((sum, p) => {
    const vaultPct = traderVaultUsePct(p, state.totalMarginBalance);
    const entry = myEntryUsd(vaultPct);
    return sum + (entry || 0);
  }, 0);
  const usedPct = (totalEntryUsd / VAULT_USD) * 100;
  els.vaultUsedPct.textContent = `${usedPct.toFixed(1)}%`;
  els.vaultUsedUsd.textContent = `$${fmtUsd(totalEntryUsd)} dağıtıldı`;

  els.traderBalance.textContent = state.totalMarginBalance != null ? `$${fmtUsd(state.totalMarginBalance)}` : "—";

  if (state.lastUpdate) {
    const d = new Date(state.lastUpdate);
    els.lastUpdateFoot.textContent = `son güncelleme ${d.toLocaleTimeString("tr-TR")}`;
  }
}

function renderHistory(state) {
  const closed = state.closedLog || [];
  els.historyList.innerHTML = "";
  if (closed.length === 0) {
    els.historyEmpty.style.display = "flex";
  } else {
    els.historyEmpty.style.display = "none";
    for (const p of closed) {
      const card = buildPositionCard(p, state.totalMarginBalance, { closed: true });
      els.historyList.appendChild(card);
    }
  }
}

function setConnLive(isLive, isError = false) {
  els.connDot.classList.toggle("live", isLive && !isError);
  els.connDot.classList.toggle("error", isError);
  els.connLabel.textContent = isError ? "BAĞLANTI HATASI" : isLive ? "CANLI" : "BAĞLANTI ARANIYOR";
}

function applySnapshot(state) {
  setConnLive(!!state.lastUpdate, /ERROR|FATAL/.test(state.connectionState || ""));
  renderPositions(state);
  renderHistory(state);
  if (state.connectionMessage) {
    els.statusMessage.textContent = state.connectionMessage;
  }
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener("open", () => {
    reconnectDelay = 1000;
    els.statusMessage.textContent = "Sunucuya bağlanıldı.";
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "SNAPSHOT") {
      applySnapshot(msg.payload);
    } else if (msg.type === "EVENTS") {
      for (const ev of msg.payload) {
        showToast(ev.type, ev.position);
      }
    } else if (msg.type === "STATUS") {
      els.statusMessage.textContent = msg.payload.connectionMessage || "";
      setConnLive(true, /ERROR|FATAL/.test(msg.payload.connectionState || ""));
    }
  });

  ws.addEventListener("close", () => {
    setConnLive(false);
    els.statusMessage.textContent = "Bağlantı koptu, yeniden deneniyor...";
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 15000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    els.positionsPanel.classList.toggle("hidden", target !== "positions");
    els.historyPanel.classList.toggle("hidden", target !== "history");
  });
});

function tickClock() {
  els.serverTime.textContent = new Date().toLocaleTimeString("tr-TR");
}
setInterval(tickClock, 1000);
tickClock();

connect();
