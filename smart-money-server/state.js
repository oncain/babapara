function positionKey(p) {
  return `${p.symbol}_${p.side}`;
}

function isSamePosition(a, b) {
  return a.entryPrice === b.entryPrice && a.marginUsd === b.marginUsd && a.side === b.side;
}

class StateStore {
  constructor() {
    this.openPositions = {};
    this.closedLog = [];
    this.totalMarginBalance = null;
    this.lastUpdate = null;
    this.connectionState = "BOOTING";
    this.connectionMessage = "Sistem başlatılıyor...";
  }

  applyStatus({ state, message }) {
    this.connectionState = state;
    if (message) this.connectionMessage = message;
    return { connectionState: this.connectionState, connectionMessage: this.connectionMessage };
  }

  applyUpdate({ positions, totalMarginBalance }) {
    const incomingMap = {};
    for (const p of positions) {
      incomingMap[positionKey(p)] = p;
    }

    const events = [];

    for (const key of Object.keys(incomingMap)) {
      const incoming = incomingMap[key];
      const existing = this.openPositions[key];
      if (!existing) {
        events.push({ type: "OPEN", position: incoming, ts: Date.now() });
      } else if (!isSamePosition(existing, incoming)) {
        events.push({ type: "UPDATE", position: incoming, ts: Date.now() });
      }
    }

    for (const key of Object.keys(this.openPositions)) {
      if (!incomingMap[key]) {
        events.push({ type: "CLOSE", position: this.openPositions[key], ts: Date.now() });
      }
    }

    for (const ev of events) {
      if (ev.type === "CLOSE") {
        this.closedLog.unshift({ ...ev.position, closedAt: ev.ts });
      }
    }
    this.closedLog = this.closedLog.slice(0, 50);

    this.openPositions = incomingMap;
    if (totalMarginBalance != null) this.totalMarginBalance = totalMarginBalance;
    this.lastUpdate = Date.now();

    return events;
  }

  snapshot() {
    return {
      openPositions: this.openPositions,
      closedLog: this.closedLog,
      totalMarginBalance: this.totalMarginBalance,
      lastUpdate: this.lastUpdate,
      connectionState: this.connectionState,
      connectionMessage: this.connectionMessage
    };
  }
}

module.exports = { StateStore, positionKey };
