const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { BinanceScraper } = require("./scraper");
const { StateStore } = require("./state");

const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const store = new StateStore();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "SNAPSHOT", payload: store.snapshot() }));
});

const scraper = new BinanceScraper({
  onUpdate: (data) => {
    const events = store.applyUpdate(data);
    if (events.length > 0) {
      broadcast("EVENTS", events);
    }
    broadcast("SNAPSHOT", store.snapshot());
  },
  onStatus: (statusUpdate) => {
    const changed = store.applyStatus(statusUpdate);
    broadcast("STATUS", changed);
    console.log(`[scraper] ${statusUpdate.state}${statusUpdate.message ? " - " + statusUpdate.message : ""}`);
  }
});

app.get("/api/state", (req, res) => {
  res.json(store.snapshot());
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true, connectionState: store.connectionState });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Smart Money Live Tracker server listening on port ${PORT}`);
  scraper.start().catch((err) => {
    console.error("Scraper failed to start:", err);
  });
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await scraper.stop();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", async () => {
  await scraper.stop();
  server.close(() => process.exit(0));
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
