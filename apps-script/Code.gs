/**
 * PT Tracker ⇄ Google Sheet sync.
 *
 * Install (once): Extensions → Apps Script in the "PT Client Tracker" sheet, paste this file,
 * set the two Script properties below, run setup(), then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). Full steps: README.md → "Connect the sheet".
 *
 * Script properties (Project Settings → Script properties):
 *   SHARED_SECRET  long random string, same value as the Worker's SHEET_SECRET secret
 *   WORKER_URL     https://pt-tracker.stackmoth.com
 *
 * What it does:
 *   - Adds two hidden columns to each synced tab: _id (permanent row id) and _updated (last change time).
 *   - When someone edits, inserts or deletes rows in the sheet, sends that tab's rows to the Worker.
 *   - Serves pull/apply requests from the Worker so app changes are written into the sheet.
 * Edits made by this script (for the app) do not fire the edit trigger, so changes never bounce back.
 */

var TRACKED_TABS = ['Clients', 'Session Log', 'Strength Log'];
var ID_HEADER = '_id';
var UPDATED_HEADER = '_updated';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHARED_SECRET')) {
    throw new Error('Set SHARED_SECRET in Project Settings → Script properties, then run setup() again.');
  }
  var ss = SpreadsheetApp.getActive();
  TRACKED_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Missing tab: ' + name);
    ensureMetaColumns_(sh);
    withLock_(function () {
      assignMissingIds_(sh, headerInfo_(sh));
    });
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'onSheetEdit' || fn === 'onSheetChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  Logger.log('Setup done. Now deploy as a web app (Deploy → New deployment → Web app).');
}

/** Run from the editor to check the Worker connection. */
function testNotify() {
  var res = notify_(TRACKED_TABS);
  Logger.log(res);
}

// ---------------------------------------------------------------------------
// Triggers (installed by setup)
// ---------------------------------------------------------------------------

function onSheetEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (TRACKED_TABS.indexOf(sh.getName()) < 0) return;
  var info = headerInfo_(sh);
  if (!info.idCol) return;

  var first = Math.max(2, e.range.getRow());
  var last = e.range.getRow() + e.range.getNumRows() - 1;
  if (last >= first) {
    withLock_(function () {
      stampRows_(sh, info, first, last - first + 1);
    });
  }
  notify_([sh.getName()]);
}

function onSheetChange(e) {
  var type = e && e.changeType;
  // EDIT is handled by onSheetEdit; FORMAT changes don't matter.
  if (type === 'EDIT' || type === 'FORMAT') return;
  notify_(TRACKED_TABS);
}

// ---------------------------------------------------------------------------
// Web app: called by the Worker
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, service: 'pt-tracker-sheet' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

  try {
    if (body.action === 'pull') {
      var tabs = withLock_(function () {
        return TRACKED_TABS.map(function (name) {
          return snapshot_(SpreadsheetApp.getActive().getSheetByName(name));
        });
      });
      return json_({ ok: true, tabs: tabs });
    }
    if (body.action === 'apply') {
      var results = withLock_(function () {
        var out = (body.ops || []).map(function (op) {
          try {
            return applyOp_(op);
          } catch (err) {
            return { id: op.id, ok: false, error: String(err && err.message ? err.message : err) };
          }
        });
        SpreadsheetApp.flush();
        return out;
      });
      return json_({ ok: true, results: results });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

/** Header row info. Columns are 1-based. dataCols = columns that are not _id/_updated. */
function headerInfo_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var raw = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h == null ? '' : h).trim();
  });
  while (raw.length && raw[raw.length - 1] === '') raw.pop();
  var idCol = raw.indexOf(ID_HEADER) + 1;
  var updCol = raw.indexOf(UPDATED_HEADER) + 1;
  var dataCols = [];
  raw.forEach(function (h, i) {
    if (h !== ID_HEADER && h !== UPDATED_HEADER) dataCols.push(i + 1);
  });
  return { headers: raw, lastCol: raw.length, idCol: idCol, updCol: updCol, dataCols: dataCols };
}

function ensureMetaColumns_(sh) {
  var info = headerInfo_(sh);
  var next = info.lastCol + 1;
  if (!info.idCol) {
    if (sh.getMaxColumns() < next) sh.insertColumnsAfter(sh.getMaxColumns(), next - sh.getMaxColumns());
    sh.getRange(1, next).setValue(ID_HEADER);
    next++;
  }
  if (!info.updCol) {
    if (sh.getMaxColumns() < next) sh.insertColumnsAfter(sh.getMaxColumns(), next - sh.getMaxColumns());
    sh.getRange(1, next).setValue(UPDATED_HEADER);
  }
  info = headerInfo_(sh);
  sh.getRange(1, info.idCol, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, info.updCol, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.hideColumns(info.idCol);
  sh.hideColumns(info.updCol);
}

/** A row counts as present when any data cell holds a typed value (formula results don't count). */
function rowPresent_(values, formulas, info) {
  for (var k = 0; k < info.dataCols.length; k++) {
    var c = info.dataCols[k] - 1;
    if (values[c] !== '' && values[c] !== null && !formulas[c]) return true;
  }
  return false;
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function assignMissingIds_(sh, info) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2 || !info.idCol) return;
  var range = sh.getRange(2, 1, lastRow - 1, info.lastCol);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var ids = sh.getRange(2, info.idCol, lastRow - 1, 1).getValues();
  var changed = false;
  var seen = {};
  for (var r = 0; r < values.length; r++) {
    if (!rowPresent_(values[r], formulas[r], info)) continue;
    var id = String(ids[r][0] || '');
    // Copied rows carry the hidden id along: give the copy a fresh one.
    if (!id || seen[id]) {
      id = newId_();
      ids[r][0] = id;
      changed = true;
    }
    seen[id] = true;
  }
  if (changed) sh.getRange(2, info.idCol, lastRow - 1, 1).setValues(ids);
}

/** After a user edit: give new rows an id, stamp _updated, clear ids of rows that were emptied. */
function stampRows_(sh, info, first, count) {
  if (!info.idCol || !info.updCol) return;
  var range = sh.getRange(first, 1, count, info.lastCol);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var now = new Date().toISOString();
  var ids = [];
  var stamps = [];
  for (var r = 0; r < count; r++) {
    var id = values[r][info.idCol - 1];
    if (rowPresent_(values[r], formulas[r], info)) {
      ids.push([id || newId_()]);
      stamps.push([now]);
    } else {
      ids.push(['']);
      stamps.push(['']);
    }
  }
  sh.getRange(first, info.idCol, count, 1).setValues(ids);
  sh.getRange(first, info.updCol, count, 1).setValues(stamps);
}

function serialize_(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return v;
}

function readRow_(sh, info, row, tz) {
  var vals = sh.getRange(row, 1, 1, info.lastCol).getValues()[0];
  return info.dataCols.map(function (c) {
    return serialize_(vals[c - 1], tz);
  });
}

function dataHeaders_(info) {
  return info.dataCols.map(function (c) {
    return info.headers[c - 1];
  });
}

function snapshot_(sh) {
  var info = headerInfo_(sh);
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var out = { tab: sh.getName(), headers: dataHeaders_(info), rows: [] };
  if (!info.idCol) {
    out.error = 'missing _id column, run setup()';
    return out;
  }
  assignMissingIds_(sh, info);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return out;
  var range = sh.getRange(2, 1, lastRow - 1, info.lastCol);
  var values = range.getValues();
  var formulas = range.getFormulas();
  for (var r = 0; r < values.length; r++) {
    if (!rowPresent_(values[r], formulas[r], info)) continue;
    var upd = info.updCol ? values[r][info.updCol - 1] : '';
    out.rows.push({
      id: String(values[r][info.idCol - 1]),
      updated: upd instanceof Date ? upd.toISOString() : String(upd || ''),
      row: r + 2,
      values: info.dataCols.map(function (c) {
        return serialize_(values[r][c - 1], tz);
      }),
    });
  }
  return out;
}

function findRow_(sh, info, id) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2 || !id) return 0;
  var ids = sh.getRange(2, info.idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(id)) return r + 2;
  }
  return 0;
}

/** Convert a value from the Worker into what we write into a cell. */
function toCell_(v, tz) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.date) return Utilities.parseDate(v.date, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  // Keep text as text: stop Sheets turning "10/12" into a date or "=..." into a formula.
  if (/^[=+]/.test(s) || /^[\d\s.,:\/\-]+$/.test(s)) return "'" + s;
  return s;
}

/**
 * op = { op: 'upsert'|'delete', tab, id, updated, values: { header: value } }
 * Upserts are skipped (conflict) when the sheet row was edited after the app's change.
 */
function applyOp_(op) {
  var sh = SpreadsheetApp.getActive().getSheetByName(op.tab);
  if (!sh) throw new Error('Missing tab: ' + op.tab);
  var info = headerInfo_(sh);
  if (!info.idCol || !info.updCol) throw new Error('Run setup() first');
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var row = findRow_(sh, info, op.id);

  if (op.op === 'delete') {
    if (row) sh.deleteRow(row);
    return { id: op.id, ok: true, deleted: true };
  }

  var headerResult = dataHeaders_(info);
  if (row) {
    var current = sh.getRange(row, info.updCol).getValue();
    current = current instanceof Date ? current.toISOString() : String(current || '');
    if (current && op.updated && current > op.updated) {
      return {
        id: op.id,
        ok: true,
        conflict: true,
        headers: headerResult,
        values: readRow_(sh, info, row, tz),
        updated: current,
      };
    }
  } else {
    row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    if (row > 2) {
      var prev = sh.getRange(row - 1, 1, 1, info.lastCol);
      var target = sh.getRange(row, 1, 1, info.lastCol);
      prev.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      // Carry formulas (e.g. Sessions in chat) down into the new row.
      var r1c1 = prev.getFormulasR1C1()[0];
      for (var c = 0; c < r1c1.length; c++) {
        if (r1c1[c]) sh.getRange(row, c + 1).setFormulaR1C1(r1c1[c]);
      }
    }
  }

  var rowRange = sh.getRange(row, 1, 1, info.lastCol);
  var vals = rowRange.getValues()[0];
  var formulas = rowRange.getFormulas()[0];
  var out = vals.map(function (v, i) {
    return formulas[i] ? formulas[i] : v;
  });
  var lower = info.headers.map(function (h) {
    return h.toLowerCase();
  });
  var skipped = [];
  Object.keys(op.values || {}).forEach(function (header) {
    var i = lower.indexOf(String(header).trim().toLowerCase());
    if (i < 0 || i === info.idCol - 1 || i === info.updCol - 1) {
      skipped.push(header);
      return;
    }
    if (formulas[i]) return; // never overwrite a formula
    out[i] = toCell_(op.values[header], tz);
  });
  out[info.idCol - 1] = String(op.id);
  out[info.updCol - 1] = String(op.updated || new Date().toISOString());
  rowRange.setValues([out]);

  return {
    id: op.id,
    ok: true,
    row: row,
    headers: headerResult,
    values: readRow_(sh, info, row, tz),
    updated: out[info.updCol - 1],
    skipped: skipped,
  };
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function notify_(tabNames) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WORKER_URL');
  var secret = props.getProperty('SHARED_SECRET');
  if (!url || !secret) return 'WORKER_URL or SHARED_SECRET not set';
  var ss = SpreadsheetApp.getActive();
  try {
    var tabs = withLock_(function () {
      return tabNames.map(function (name) {
        return snapshot_(ss.getSheetByName(name));
      });
    });
    var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/hook/sheet', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Secret': secret },
      payload: JSON.stringify({ tabs: tabs }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
    return res.getResponseCode() + ' ' + res.getContentText().slice(0, 300);
  } catch (err) {
    Logger.log('notify failed: ' + err);
    return 'error ' + err;
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
