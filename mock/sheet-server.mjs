// Local stand-in for the Apps Script web app (apps-script/Code.gs), for development and tests.
// It keeps an in-memory "sheet" with made-up data, answers the Worker's pull/apply calls the
// same way the real script does, and can simulate a person editing the sheet (which fires the
// Worker hook, like the onEdit trigger).
//
//   node mock/sheet-server.mjs            # http://127.0.0.1:8788
//   POST /            Worker protocol: {secret, action: "pull" | "apply", ops}
//   POST /__edit      {tab, id?, values: {Header: value}}  simulate a sheet edit (id omitted = new row)
//   POST /__delete    {tab, id}                          simulate deleting a row in the sheet
//   POST /__wipe      {tab}                              simulate a tab being emptied by mistake
//   POST /__offline   {offline: true}                    make Worker calls fail
//   POST /__hook      {enabled: false}                   stop notifying the Worker
//   POST /__reset     re-seed;   GET /__state   dump

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 8788);
const SECRET = process.env.SHEET_SECRET ?? "dev-secret";
const WORKER_URL = process.env.WORKER_URL ?? "http://127.0.0.1:8787";

const HEADERS = {
  Clients: [
    "Client",
    "Start date",
    "Goal",
    "Package",
    "Price (AED/month)",
    "Sessions in chat",
    "Last session",
    "Last payment",
    "Payment status",
    "Schedule / next session",
    "Notes",
    "_id",
    "_updated",
  ],
  "Session Log": ["Date", "Client", "Session / focus", "Evidence in chat", "_id", "_updated"],
  "Strength Log": ["Date", "Client", "Workout", "Exercise", "Load as sent", "Weight (kg)", "Sets x reps", "_id", "_updated"],
};
const FORMULA_HEADERS = { Clients: ["Sessions in chat", "Last session"] };

let state;
let offline = false;
let hookEnabled = true;

// ---------------------------------------------------------------------------------------------
// Seed data (fictional people)

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const D = (iso) => ({ date: iso });
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const TEMPLATES = {
  "Upper 1": [
    ["Lat pulldown", 40, "3 x 10"],
    ["Wide bar row", 35, "2 x 10"],
    ["Incline DB press", 12.5, "3 x 8–10"],
    ["Shoulder press", 10, "2 x 8"],
    ["Lateral raise", 5, "2 x 10–12"],
    ["Face pull", 15, "2 x 10–12"],
    ["Preacher curl", 7.5, "2 x 10"],
  ],
  "Upper 2": [
    ["Bench press", 20, "2 x 8"],
    ["Cable row", 45, "3 x 10"],
    ["Chest fly", 10, "2 x 10"],
    ["Lateral raise", "2nd plate", "3 x 10"],
    ["Tricep pushdown", 15, "2 x 12"],
    ["Tricep overhead extension", 10, "2 x 12"],
    ["Seated DB curl", 7.5, "2 x 8"],
  ],
  Lower: [
    ["Squat", 30, ""],
    ["Leg extension", 40, ""],
    ["Hamstring curl", 40, ""],
    ["Bulgarian split squat", 10, ""],
    ["Calf raise", 30, ""],
  ],
};

function seed() {
  const rand = rng(42);
  // Deterministic ids, so a reset gives the same rows the Worker already knows.
  const idRand = rng(7);
  const id = () => Math.floor(idRand() * 2 ** 32).toString(16).padStart(8, "0") + Math.floor(idRand() * 2 ** 32).toString(16).padStart(8, "0");
  const clients = [
    ["Alex", "2026-08-12", "Fat loss", "Monthly", 1200, "2026-10-15", "Paid 1,200", "Most days, 4pm", "Calorie target 2,000 a day plus steps."],
    ["Maya", "2026-08-24", "Strength", "10-session blocks", 1000, "2026-10-02", "Block 3 paid; Day 7 of 10 done", "Mornings around 10am", "Logs their own day numbers."],
    ["Omar", "2026-09-17", "Lean and defined", "3 sessions a week, monthly", 1000, "2026-10-14", "Paid", "Mostly 9am", "Wants flexibility to move sessions."],
    ["Priya", "2026-10-09", "Get back into a routine", "Per session, 2 a week", "100/session", "2026-10-12", "Paid for this week and next", "Mon 9:50am, Thu 9am", "Free trial on 9 Oct."],
    ["Ben", "2026-10-01", "", "3 sessions a week, monthly", 1200, null, "Not paid", "Away this week", "Will pay at the end of the classes."],
    ["Leo", "2026-10-13", "", "Monthly", "", "2026-10-21", "Paid", "Evenings, 5:30pm", "Upper back spasm 14 Oct."],
  ];
  const tabs = { Clients: [], "Session Log": [], "Strength Log": [] };
  const stamp = "2026-10-20T08:00:00.000Z";
  for (const [name, start, goal, pkg, price, paid, status, sched, notes] of clients) {
    tabs.Clients.push([name, D(start), goal, pkg, price, null, null, paid ? D(paid) : "", status, sched, notes, id(), stamp]);
  }
  const plan = ["Upper 1", "Upper 2", "Lower"];
  for (const [name, start] of clients.slice(0, 4).map((c) => [c[0], c[1]])) {
    let date = start;
    let n = 0;
    while (date <= "2026-10-24") {
      const workout = plan[n % 3];
      tabs["Session Log"].push([D(date), name, workout, "Weights sent", id(), stamp]);
      if (date >= "2026-10-01") {
        for (const [ex, base, sets] of TEMPLATES[workout]) {
          const w = typeof base === "number" ? Math.round((base + n * 0.6 * rand()) * 4) / 4 : "";
          tabs["Strength Log"].push([D(date), name, workout, ex, typeof base === "number" ? `${w}kg` : base, w, sets, id(), stamp]);
        }
      }
      date = addDays(date, 2 + Math.floor(rand() * 3));
      n++;
    }
  }
  state = tabs;
}

function id() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// ---------------------------------------------------------------------------------------------
// Sheet behaviour (mirrors Code.gs)

const isDate = (v) => v && typeof v === "object" && "date" in v;

function formulaValue(tab, header, row) {
  if (tab !== "Clients") return null;
  const name = row[0];
  const sessions = state["Session Log"].filter((r) => r[1] === name);
  if (header === "Sessions in chat") return sessions.length;
  if (header === "Last session") {
    const dates = sessions.map((r) => r[0].date).sort();
    return dates.length ? D(dates[dates.length - 1]) : 0;
  }
  return null;
}

function cell(tab, header, row, i) {
  if ((FORMULA_HEADERS[tab] ?? []).includes(header)) return formulaValue(tab, header, row);
  return row[i];
}

function serialize(v) {
  if (isDate(v)) return v.date;
  return v ?? "";
}

function dataIdx(tab) {
  return HEADERS[tab].map((h, i) => i).filter((i) => !HEADERS[tab][i].startsWith("_"));
}

function present(tab, row) {
  return dataIdx(tab).some((i) => {
    if ((FORMULA_HEADERS[tab] ?? []).includes(HEADERS[tab][i])) return false;
    return row[i] !== "" && row[i] !== null && row[i] !== undefined;
  });
}

function snapshot(tab) {
  const h = HEADERS[tab];
  const idI = h.indexOf("_id");
  const upI = h.indexOf("_updated");
  const seen = new Set();
  const rows = [];
  state[tab].forEach((row, r) => {
    if (!present(tab, row)) return;
    if (!row[idI] || seen.has(row[idI])) row[idI] = id();
    seen.add(row[idI]);
    rows.push({
      id: row[idI],
      updated: row[upI] ?? "",
      row: r + 2,
      values: dataIdx(tab).map((i) => serialize(cell(tab, h[i], row, i))),
    });
  });
  return { tab, headers: dataIdx(tab).map((i) => h[i]), rows };
}

function toCell(v) {
  if (v === null || v === undefined) return "";
  if (isDate(v)) return D(v.date);
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  return s.startsWith("'") ? s.slice(1) : s;
}

function readRow(tab, row) {
  const h = HEADERS[tab];
  return dataIdx(tab).map((i) => serialize(cell(tab, h[i], row, i)));
}

function applyOp(op) {
  const tab = op.tab;
  if (!state[tab]) throw new Error("Missing tab: " + tab);
  const h = HEADERS[tab];
  const idI = h.indexOf("_id");
  const upI = h.indexOf("_updated");
  let r = state[tab].findIndex((row) => row[idI] === op.id);
  if (op.op === "delete") {
    if (r >= 0) state[tab].splice(r, 1);
    return { id: op.id, ok: true, deleted: true };
  }
  const headers = dataIdx(tab).map((i) => h[i]);
  if (r >= 0) {
    const current = state[tab][r][upI] || "";
    if (current && op.updated && current > op.updated) {
      return { id: op.id, ok: true, conflict: true, headers, values: readRow(tab, state[tab][r]), updated: current };
    }
  } else {
    state[tab].push(h.map(() => ""));
    r = state[tab].length - 1;
  }
  const row = state[tab][r];
  const lower = h.map((x) => x.toLowerCase());
  for (const [header, v] of Object.entries(op.values ?? {})) {
    const i = lower.indexOf(header.trim().toLowerCase());
    if (i < 0 || i === idI || i === upI) continue;
    if ((FORMULA_HEADERS[tab] ?? []).includes(h[i])) continue;
    row[i] = toCell(v);
  }
  row[idI] = op.id;
  row[upI] = op.updated || new Date().toISOString();
  return { id: op.id, ok: true, row: r + 2, headers, values: readRow(tab, row), updated: row[upI] };
}

async function notify(tabs) {
  if (!hookEnabled) return { skipped: true };
  const res = await fetch(WORKER_URL + "/api/hook/sheet", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sheet-secret": SECRET },
    body: JSON.stringify({ tabs: tabs.map(snapshot) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A person typing into the sheet: change cells, stamp _updated, then the trigger notifies. */
async function userEdit({ tab, id: rowId, values }) {
  const h = HEADERS[tab];
  const idI = h.indexOf("_id");
  const upI = h.indexOf("_updated");
  let row = rowId ? state[tab].find((x) => x[idI] === rowId) : null;
  if (!row) {
    row = h.map(() => "");
    state[tab].push(row);
  }
  for (const [header, v] of Object.entries(values)) {
    const i = h.indexOf(header);
    if (i < 0) throw new Error("no header " + header);
    row[i] = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? D(v) : v;
  }
  if (!row[idI]) row[idI] = id();
  row[upI] = new Date().toISOString();
  return { id: row[idI], hook: await notify([tab]) };
}

// ---------------------------------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

seed();

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    try {
      if (req.method === "POST" && req.url === "/") {
        if (offline) return send(res, 503, { ok: false, error: "offline" });
        if (body.secret !== SECRET) return send(res, 200, { ok: false, error: "unauthorized" });
        if (body.action === "pull") return send(res, 200, { ok: true, tabs: Object.keys(HEADERS).map(snapshot) });
        if (body.action === "apply") {
          const results = (body.ops ?? []).map((op) => {
            try {
              return applyOp(op);
            } catch (err) {
              return { id: op.id, ok: false, error: err.message };
            }
          });
          return send(res, 200, { ok: true, results });
        }
        return send(res, 200, { ok: false, error: "unknown action" });
      }
      if (req.url === "/__state") return send(res, 200, Object.fromEntries(Object.keys(HEADERS).map((t) => [t, snapshot(t)])));
      if (req.url === "/__edit") return send(res, 200, await userEdit(body));
      if (req.url === "/__delete") {
        const idI = HEADERS[body.tab].indexOf("_id");
        state[body.tab] = state[body.tab].filter((r) => r[idI] !== body.id);
        return send(res, 200, { hook: await notify(Object.keys(HEADERS)) });
      }
      if (req.url === "/__wipe") {
        state[body.tab] = [];
        return send(res, 200, { ok: true });
      }
      if (req.url === "/__offline") {
        offline = !!body.offline;
        return send(res, 200, { offline });
      }
      if (req.url === "/__hook") {
        hookEnabled = body.enabled !== false;
        return send(res, 200, { hookEnabled });
      }
      if (req.url === "/__reset") {
        seed();
        offline = false;
        hookEnabled = true;
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { ok: false, error: err.message });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock sheet on http://127.0.0.1:${PORT} → hook ${WORKER_URL}`));
