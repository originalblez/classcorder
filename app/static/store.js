// Pupils and notes live in a folder the teacher chooses, ideally inside OneDrive:
//   Teacher Notes/Data/2026-27.json   one file per school year (September to August),
//                                     holding that year's classes, pupils and notes
//   Teacher Notes/Exports/            readable exports
// The OneDrive desktop app syncs the folder. Uses the File System Access API (Chrome/Edge).
// The browser only remembers which folder was chosen (in IndexedDB).

const DATA_DIR = 'Data';
const EXPORTS_DIR = 'Exports';
const YEAR_FILE = /^(\d{4}-\d{2})\.json$/;
const SETTINGS_DB = 'pupil-notes-settings';

let root = null;
let year = null;  // the school year being viewed, e.g. "2026-27"

export const supported = () => 'showDirectoryPicker' in window;

// --- School years ---
export function schoolYearFor(date = new Date()) {
  const start = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;  // September
  return `${start}-${String(start + 1).slice(2)}`;
}
export const selectedYear = () => year;
export const isCurrentYear = () => year === schoolYearFor();

export async function listYears() {
  const years = [];
  for await (const name of (await dataDir()).keys()) {
    const m = name.match(YEAR_FILE);
    if (m) years.push(m[1]);
  }
  return years.sort().reverse();
}

export async function selectYear(y) {
  if (!(await listYears()).includes(y)) throw new Error(`No data for ${y}`);
  year = y;
}

// Creates the current school year's file, optionally copying classes and pupils from another year.
export async function startCurrentYear(copyFrom = null) {
  const current = schoolYearFor();
  const from = copyFrom ? await read(copyFrom) : { classes: [], pupils: [] };
  await write(current, { app: 'pupil-notes', version: 3, school_year: current, classes: from.classes, pupils: from.pupils, notes: [] });
  year = current;
}

// --- Remembering the chosen folder ---
function settingsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SETTINGS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('settings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function setting(key, value) {
  const db = await settingsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', value === undefined ? 'readonly' : 'readwrite');
    const s = tx.objectStore('settings');
    const req = value === undefined ? s.get(key) : s.put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns 'connected', 'needs-permission' (a folder was chosen before but access must
// be granted again with a click) or 'not-chosen'.
export async function restoreFolder() {
  const handle = await setting('folder').catch(() => null);
  if (!handle) return 'not-chosen';
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    await useFolder(handle);
    return 'connected';
  }
  return 'needs-permission';
}

// Must be called from a click.
export async function reconnectFolder() {
  const handle = await setting('folder');
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Access to the folder was not allowed.');
  await useFolder(handle);
}

// Must be called from a click.
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'teacher-notes', mode: 'readwrite', startIn: 'documents' });
  await useFolder(handle);
  await setting('folder', handle);
}

export const folderName = () => root?.name;

// Connects to the folder and selects the current school year if it has a file,
// otherwise the most recent year (or none, for a brand new folder).
async function useFolder(handle) {
  root = handle;
  const years = await listYears();
  year = years.includes(schoolYearFor()) ? schoolYearFor() : years[0] ?? null;
}

const dataDir = () => root.getDirectoryHandle(DATA_DIR, { create: true });
const exportsDir = () => root.getDirectoryHandle(EXPORTS_DIR, { create: true });

// --- Reading and writing a year's data file ---
async function read(y = year) {
  if (!y) throw new Error('No school year selected');
  const file = await (await (await dataDir()).getFileHandle(`${y}.json`)).getFile();
  const data = JSON.parse(await file.text());
  if (data?.app !== 'pupil-notes') throw new Error(`${DATA_DIR}/${y}.json is not a Classcorder data file.`);
  data.classes ??= [];
  data.pupils ??= [];
  data.notes ??= [];
  return data;
}

// createWritable writes to a temporary file and swaps it in on close, so a crash
// mid-write never leaves a half-written data file.
async function write(y, data) {
  const handle = await (await dataDir()).getFileHandle(`${y}.json`, { create: true });
  const w = await handle.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

// Re-reads the file before every change so edits synced from elsewhere aren't lost.
async function update(fn) {
  const data = await read();
  const result = fn(data);
  await write(year, data);
  return result;
}

const byName = (a, b) => a.name.localeCompare(b.name);
const newest = (a, b) => b.created_at.localeCompare(a.created_at);

// --- Classes ---
// The selected year's classes, each with its pupils and their note counts, for the sidebar.
export async function listTree() {
  if (!year) return [];
  const data = await read();
  // Note count and the latest note's created_at (ISO, so the largest string is the newest) per pupil.
  const counts = new Map(), last = new Map();
  for (const n of data.notes) {
    counts.set(n.pupil_id, (counts.get(n.pupil_id) ?? 0) + 1);
    if (!(last.get(n.pupil_id) > n.created_at)) last.set(n.pupil_id, n.created_at);
  }
  return data.classes.sort(byName).map(c => ({
    ...c,
    pupils: data.pupils.filter(p => p.class_id === c.id).sort(byName)
      .map(p => ({ ...p, notes: counts.get(p.id) ?? 0, last: last.get(p.id) ?? null })),
  }));
}

// Creates a class (no id) or updates one, with its pupils, in a single write.
// pupils: [{id?, name}]. Entries without an id are added; those with one are renamed.
// removed: ids of pupils to delete with their notes.
export async function saveClass({ id = null, name, pupils = [], removed = [] }) {
  name = name.trim();
  if (!name) throw new Error('Class name is required');
  pupils = pupils.map(p => ({ ...p, name: p.name.trim() }));
  if (pupils.some(p => !p.name)) throw new Error('Pupil names can\'t be blank. Remove the pupil instead.');
  const seen = new Set();
  for (const p of pupils) {
    if (seen.has(p.name.toLowerCase())) throw new Error(`${p.name} is listed twice`);
    seen.add(p.name.toLowerCase());
  }
  return update(data => {
    if (data.classes.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) throw new Error('That class already exists');
    let klass = id && data.classes.find(c => c.id === id);
    if (id && !klass) throw new Error('Class not found. It may have been deleted elsewhere.');
    if (!klass) {
      klass = { id: crypto.randomUUID(), name };
      data.classes.push(klass);
    }
    klass.name = name;
    const gone = new Set(removed);
    data.pupils = data.pupils.filter(p => !gone.has(p.id));
    data.notes = data.notes.filter(n => !gone.has(n.pupil_id));
    for (const p of pupils) {
      if (!p.id) data.pupils.push({ id: crypto.randomUUID(), name: p.name, class_id: klass.id });
      else {
        const existing = data.pupils.find(x => x.id === p.id);
        if (existing) existing.name = p.name;
      }
    }
    return klass;
  });
}

// Deletes the class with its pupils and their notes.
export const deleteClass = id =>
  update(data => {
    const pupilIds = new Set(data.pupils.filter(p => p.class_id === id).map(p => p.id));
    data.classes = data.classes.filter(c => c.id !== id);
    data.pupils = data.pupils.filter(p => !pupilIds.has(p.id));
    data.notes = data.notes.filter(n => !pupilIds.has(n.pupil_id));
  });

// --- Pupils ---
export const listPupils = async classId =>
  (year ? (await read()).pupils.filter(p => p.class_id === classId).sort(byName) : []);

export const deletePupil = id =>
  update(data => {
    data.pupils = data.pupils.filter(p => p.id !== id);
    data.notes = data.notes.filter(n => n.pupil_id !== id);
  });

export const listNotes = async pupilId => (await read()).notes.filter(n => n.pupil_id === pupilId).sort(newest);

// transcript: the raw speech-to-text output, kept alongside the final text for reference.
// cost_usd: estimated Mistral cost of producing the note.
export async function addNote(pupilId, text, { transcript = null, cost_usd = null } = {}) {
  text = text.trim();
  if (!text) throw new Error('Note is empty');
  return update(data => {
    const note = { id: crypto.randomUUID(), pupil_id: pupilId, text, created_at: new Date().toISOString() };
    if (transcript) note.transcript = transcript;
    if (cost_usd != null) note.cost_usd = cost_usd;
    data.notes.push(note);
    return note;
  });
}

export async function updateNote(id, text) {
  text = text.trim();
  if (!text) throw new Error('Note is empty');
  return update(data => {
    const note = data.notes.find(n => n.id === id);
    if (!note) throw new Error('Note not found. It may have been deleted elsewhere.');
    note.text = text;
    note.updated_at = new Date().toISOString();
    return note;
  });
}

export const deleteNote = id =>
  update(data => {
    data.notes = data.notes.filter(n => n.id !== id);
  });

// Classes, pupils and the notes written from `from` up to (not including) `to`, for reports.
export async function reportData(from, to) {
  const data = await read();
  const notes = data.notes
    .filter(n => { const t = new Date(n.created_at); return t >= from && t < to; })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { classes: data.classes.sort(byName), pupils: data.pupils.sort(byName), notes };
}

export const yearCost = async () => (year ? (await read()).notes.reduce((sum, n) => sum + (n.cost_usd ?? 0), 0) : 0);

// --- Exports ---
const today = () => new Date().toISOString().slice(0, 10);
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, '').trim();
const formatDate = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export async function writeExport(filename, content) {
  const handle = await (await exportsDir()).getFileHandle(filename, { create: true });
  const w = await handle.createWritable();
  await w.write(content);
  await w.close();
  return `${EXPORTS_DIR}/${filename}`;
}

export async function exportPupil(pupil) {
  const notes = (await listNotes(pupil.id)).reverse();
  const body = notes.map(n => `${formatDate(n.created_at)}\n${n.text}`).join('\n\n');
  const text = `${pupil.name}: notes ${year}\nExported ${formatDate(new Date().toISOString())}\n\n${body || 'No notes.'}\n`;
  return writeExport(`${safeName(pupil.name)} ${year} (${today()}).txt`, text);
}

// CSV with a BOM so Excel opens it as UTF-8.
export async function exportAllCsv() {
  const data = await read();
  const classNames = new Map(data.classes.map(c => [c.id, c.name]));
  const pupils = new Map(data.pupils.map(p => [p.id, { name: p.name, klass: classNames.get(p.class_id) ?? '' }]));
  const key = n => `${pupils.get(n.pupil_id)?.klass}\u0000${pupils.get(n.pupil_id)?.name}\u0000${n.created_at}`;
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = data.notes
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map(n => [pupils.get(n.pupil_id)?.klass, pupils.get(n.pupil_id)?.name, formatDate(n.created_at), n.text, n.transcript].map(cell).join(','));
  const header = ['Class', 'Pupil', 'Date', 'Note', 'Original transcript'];
  const csv = '﻿' + [header.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
  return writeExport(`All notes ${year} (${today()}).csv`, csv);
}
