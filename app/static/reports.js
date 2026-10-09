// Reports: a class's notes for a day, week, month or other period, laid out for
// printing, saving as CSV or pasting into Excel or Word.
// The last settings used are remembered in localStorage and can be saved as named presets.
// The dates being viewed go in the URL instead, so a report opens on today by default.

import * as store from './store.js';
import { $, el, plural, openModal, confirmModal } from './dom.js';

const SETTINGS_KEY = 'report:settings';
const PRESETS_KEY = 'report:presets';
const COLLAPSED_KEY = 'report:collapsed';
const DEFAULTS = { classId: 'all', period: 'week', layout: 'table', empty: true, transcript: false, pageBreaks: false };
const PERIODS = { day: 'Day', week: 'Week', month: 'Month', year: 'School year', custom: 'Custom' };
const LAYOUTS = { table: 'Table', grid: 'Pupils × days', pupil: 'By pupil' };
const GRID_MAX_DAYS = 7;

const local = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

let settings = { ...DEFAULTS, ...local.get(SETTINGS_KEY, {}) };
let date = new Date();  // the day the period is built around (the start, for a custom period)
let until = null;       // the last day of a custom period
let routeChanged = () => {};
// Whether the controls are folded into a thin bar. A screen preference, so not part of presets.
let collapsed = local.get(COLLAPSED_KEY, false);

// --- Dates (all local time) ---
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfDay = d => addDays(d, 0);
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
};
const fmt = (d, opts) => d.toLocaleDateString('en-GB', opts);
const LONG = { day: 'numeric', month: 'long', year: 'numeric' };
const SHORT = { day: 'numeric', month: 'short', year: 'numeric' };
const longDate = d => `${fmt(d, { weekday: 'long' })} ${fmt(d, LONG)}`;
const formatTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const formatWhen = iso => `${fmt(new Date(iso), { weekday: 'short' })} ${fmt(new Date(iso), { day: 'numeric', month: 'short' })}, ${formatTime(iso)}`;

// The period being reported on: { from, to (exclusive), label }.
function period() {
  const d = startOfDay(date);
  switch (settings.period) {
    case 'day':
      return { from: d, to: addDays(d, 1), label: longDate(d) };
    case 'week': {
      const monday = addDays(d, -((d.getDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 7), label: `Week beginning ${longDate(monday)}` };
    }
    case 'month': {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      return { from: first, to: new Date(d.getFullYear(), d.getMonth() + 1, 1), label: fmt(first, { month: 'long', year: 'numeric' }) };
    }
    case 'year': {
      const start = +store.selectedYear().slice(0, 4);
      return { from: new Date(start, 8, 1), to: new Date(start + 1, 8, 1), label: `School year ${store.selectedYear()}` };
    }
    default: {
      const last = until && until >= d ? startOfDay(until) : d;
      return { from: d, to: addDays(last, 1), label: `${fmt(d, SHORT)} to ${fmt(last, SHORT)}` };
    }
  }
}

function step(direction) {
  if (settings.period === 'day') date = addDays(date, direction);
  else if (settings.period === 'week') date = addDays(date, 7 * direction);
  else if (settings.period === 'month') date = new Date(date.getFullYear(), date.getMonth() + direction, 1);
}

// Opens the next report on this class, as if it had been chosen in the Class menu.
export function useClass(classId) {
  settings = { ...settings, classId };
  local.set(SETTINGS_KEY, settings);
}

// --- URL ---
export function routeParams() {
  const params = [['date', isoDate(date)]];
  if (settings.period === 'custom' && until) params.push(['to', isoDate(until)]);
  return params;
}

export function restoreRoute(params) {
  date = parseDate(params.get('date')) ?? new Date();
  until = parseDate(params.get('to'));
}

// --- Building the report ---
async function build() {
  const { from, to, label } = period();
  const data = await store.reportData(from, to);
  // A remembered class may not exist in this school year; show all classes instead.
  const chosen = data.classes.find(c => c.id === settings.classId);
  const classes = chosen ? [chosen] : data.classes;
  const notesByPupil = new Map();
  for (const n of data.notes) {
    if (!notesByPupil.has(n.pupil_id)) notesByPupil.set(n.pupil_id, []);
    notesByPupil.get(n.pupil_id).push(n);
  }
  const groups = classes.map(klass => ({
    klass,
    pupils: data.pupils
      .filter(p => p.class_id === klass.id)
      .map(pupil => ({ pupil, notes: notesByPupil.get(pupil.id) ?? [] }))
      .filter(r => settings.empty || r.notes.length),
  }));
  const days = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const count = groups.reduce((sum, g) => sum + g.pupils.reduce((s, r) => s + r.notes.length, 0), 0);
  const classLabel = chosen ? chosen.name : 'All classes';
  return { label, classLabel, multi: !chosen, groups, days, count, title: `${classLabel}: ${label}` };
}

// Rows and columns for the table layout (also used to export the by-pupil layout).
function tableModel(r) {
  const columns = [...(r.multi ? ['Class'] : []), 'Pupil', 'Date', 'Time', 'Note', ...(settings.transcript ? ['Original transcript'] : [])];
  const rows = [];
  for (const g of r.groups) {
    for (const { pupil, notes } of g.pupils) {
      const lead = [...(r.multi ? [g.klass.name] : []), pupil.name];
      if (!notes.length) rows.push([...lead, '', '', '', ...(settings.transcript ? [''] : [])]);
      for (const n of notes) {
        const when = new Date(n.created_at);
        rows.push([...lead, fmt(when, SHORT), formatTime(n.created_at), n.text, ...(settings.transcript ? [n.transcript ?? ''] : [])]);
      }
    }
  }
  return { columns, rows };
}

// Pupils down the side, one column per day. Weekends appear only if they have notes.
function gridModel(r) {
  const key = d => isoDate(d);
  const hasNotes = new Set(r.groups.flatMap(g => g.pupils.flatMap(p => p.notes.map(n => key(new Date(n.created_at))))));
  const days = r.days.filter(d => (d.getDay() % 6 !== 0) || hasNotes.has(key(d)));
  const columns = [...(r.multi ? ['Class'] : []), 'Pupil', ...days.map(d => `${fmt(d, { weekday: 'short' })} ${fmt(d, { day: 'numeric', month: 'short' })}`)];
  const rows = [];
  for (const g of r.groups) {
    for (const { pupil, notes } of g.pupils) {
      rows.push([...(r.multi ? [g.klass.name] : []), pupil.name, ...days.map(d => notes
        .filter(n => key(new Date(n.created_at)) === key(d))
        .map(n => (settings.transcript && n.transcript && n.transcript !== n.text ? `${n.text}\n(Original: ${n.transcript})` : n.text))
        .join('\n\n'))]);
    }
  }
  return { columns, rows };
}

const gridAllowed = r => r.days.length <= GRID_MAX_DAYS;
const exportModel = r => (settings.layout === 'grid' && gridAllowed(r) ? gridModel(r) : tableModel(r));

function tableElement({ columns, rows }, className) {
  const head = el('tr', {}, ...columns.map(c => el('th', { textContent: c })));
  const body = rows.map(row => el('tr', {}, ...row.map(cell => el('td', { textContent: cell }))));
  return el('table', { className }, el('thead', {}, head), el('tbody', {}, ...body));
}

function byPupilElement(r) {
  const wrap = el('div', { className: settings.pageBreaks ? 'by-pupil breaks' : 'by-pupil' });
  for (const g of r.groups) {
    if (r.multi) wrap.append(el('h3', { className: 'report-class', textContent: g.klass.name }));
    for (const { pupil, notes } of g.pupils) {
      const section = el('section', { className: 'report-pupil' }, el('h4', { textContent: pupil.name }));
      if (!notes.length) section.append(el('p', { className: 'empty', textContent: 'No notes in this period.' }));
      for (const n of notes) {
        const item = el('div', { className: 'report-note' }, el('span', { className: 'when', textContent: formatWhen(n.created_at) }), el('p', { textContent: n.text }));
        if (settings.transcript && n.transcript && n.transcript !== n.text) {
          item.append(el('p', { className: 'transcript', textContent: `Original transcript: ${n.transcript}` }));
        }
        section.append(item);
      }
      wrap.append(section);
    }
  }
  return wrap;
}

// --- Export formats ---
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
// With a BOM so Excel opens it as UTF-8.
const toCsv = ({ columns, rows }) => '﻿' + [columns, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const toTsv = ({ columns, rows }) => [columns, ...rows].map(r => r.map(c => String(c ?? '').replace(/\s*\n\s*/g, ' / ').replace(/\t/g, ' ')).join('\t')).join('\n');
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, '').trim();

// --- Presets ---
const presets = () => local.get(PRESETS_KEY, []);
const sameSettings = (a, b) => Object.keys(DEFAULTS).every(k => a[k] === b[k]);

function applySettings(next) {
  settings = { ...DEFAULTS, ...next };
  local.set(SETTINGS_KEY, settings);
}

function openPresetModal(onSaved) {
  const m = openModal('preset-modal');
  const name = $('#p-name', m);
  $('form', m).onsubmit = e => {
    e.preventDefault();
    const value = name.value.trim();
    if (!value) { $('#p-error', m).textContent = 'Give the preset a name.'; return; }
    const list = presets().filter(p => p.name.toLowerCase() !== value.toLowerCase());
    list.push({ name: value, settings: Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, settings[k]])) });
    list.sort((a, b) => a.name.localeCompare(b.name));
    local.set(PRESETS_KEY, list);
    m.close();
    onSaved();
  };
  name.focus();
}

// --- Screen ---
export function show(main, onRouteChange) {
  routeChanged = onRouteChange;
  main.replaceChildren($('#reports-view').content.cloneNode(true));
  $('#r-year', main).textContent = `School year ${store.selectedYear()}`;

  const segmented = (box, options, key) => {
    box.replaceChildren(...Object.entries(options).map(([value, label]) => {
      const input = el('input', { type: 'radio', name: key, value });
      input.onchange = () => change({ [key]: value });
      return el('label', {}, input, el('span', { textContent: label }));
    }));
  };
  segmented($('#r-period', main), PERIODS, 'period');
  segmented($('#r-layout', main), LAYOUTS, 'layout');

  $('#r-class', main).onchange = e => change({ classId: e.target.value });
  $('#r-empty', main).onchange = e => change({ empty: e.target.checked });
  $('#r-transcript', main).onchange = e => change({ transcript: e.target.checked });
  $('#r-breaks', main).onchange = e => change({ pageBreaks: e.target.checked });
  $('#r-prev', main).onclick = () => { step(-1); dateChanged(); };
  $('#r-next', main).onclick = () => { step(1); dateChanged(); };
  $('#r-today', main).onclick = () => { date = new Date(); dateChanged(); };
  $('#r-date', main).onchange = e => { date = parseDate(e.target.value) ?? new Date(); dateChanged(); };
  $('#r-to', main).onchange = e => { until = parseDate(e.target.value); dateChanged(); };

  $('#r-preset', main).onchange = e => {
    const preset = presets().find(p => p.name === e.target.value);
    if (preset) change(preset.settings);
  };
  $('#r-save-preset', main).onclick = () => openPresetModal(update);
  $('#r-delete-preset', main).onclick = async () => {
    const name = $('#r-preset').value;
    if (!name || !(await confirmModal({
      title: `Delete the preset "${name}"?`,
      text: 'Your current settings stay as they are.',
      confirmLabel: 'Delete preset', danger: true,
    }))) return;
    local.set(PRESETS_KEY, presets().filter(p => p.name !== name));
    update();
  };

  $('#r-print', main).onclick = $('#r-bar-print', main).onclick = () => window.print();
  $('#r-bar-prev', main).onclick = () => { step(-1); dateChanged(); };
  $('#r-bar-next', main).onclick = () => { step(1); dateChanged(); };
  $('#r-toggle', main).onclick = () => {
    collapsed = !collapsed;
    local.set(COLLAPSED_KEY, collapsed);
    update();
  };
  $('#r-csv', main).onclick = () => exportCsv();
  $('#r-copy', main).onclick = () => copyReport();
  update();
}

function change(next) {
  applySettings({ ...settings, ...next });
  routeChanged();
  update();
}

function dateChanged() {
  routeChanged();
  update();
}

function status(text, error = false) {
  const s = $('#r-status');
  if (!s) return;
  s.textContent = text;
  s.className = error ? 'status error' : 'status';
}

let lastReport = null;
let building = 0;

// Syncs the controls with the settings and redraws the report.
async function update() {
  const paper = $('#r-paper');
  if (!paper) return;
  const ticket = ++building;
  const r = await build().catch(err => { status(`Could not build the report: ${err.message}`, true); return null; });
  if (!r || ticket !== building || !$('#r-paper')) return;
  lastReport = r;

  const classSelect = $('#r-class');
  const classes = await store.listTree();
  classSelect.replaceChildren(el('option', { value: 'all', textContent: 'All classes' }),
    ...classes.map(c => el('option', { value: c.id, textContent: c.name })));
  classSelect.value = classes.some(c => c.id === settings.classId) ? settings.classId : 'all';

  for (const input of document.querySelectorAll('#r-period input, #r-layout input')) {
    input.checked = settings[input.name] === input.value;
  }
  const stepping = ['day', 'week', 'month'].includes(settings.period);
  $('#r-date-control').hidden = settings.period === 'year';
  $('#r-prev').hidden = $('#r-next').hidden = !stepping;
  $('#r-date-label').textContent = settings.period === 'custom' ? 'From' : 'Date';
  $('#r-to-control').hidden = settings.period !== 'custom';
  $('#r-date').value = isoDate(date);
  $('#r-to').value = until ? isoDate(until) : '';
  $('#r-empty').checked = settings.empty;
  $('#r-transcript').checked = settings.transcript;
  $('#r-breaks').checked = settings.pageBreaks;
  $('#r-breaks-row').hidden = settings.layout !== 'pupil';

  const list = presets();
  const active = list.find(p => sameSettings(p.settings, settings));
  const presetSelect = $('#r-preset');
  presetSelect.replaceChildren(el('option', { value: '', textContent: list.length ? 'Unsaved settings' : 'No presets yet' }),
    ...list.map(p => el('option', { value: p.name, textContent: p.name })));
  presetSelect.value = active?.name ?? '';
  presetSelect.disabled = !list.length;

  const controls = $('#r-controls');
  controls.classList.toggle('collapsed', collapsed);
  const toggle = $('#r-toggle');
  toggle.textContent = collapsed ? 'Options' : 'Hide options';
  toggle.setAttribute('aria-expanded', !collapsed);
  $('#r-summary').textContent = collapsed
    ? [r.classLabel, r.label, LAYOUTS[settings.layout], active?.name].filter(Boolean).join(' · ')
    : 'Report options';
  $('#r-bar-prev').hidden = $('#r-bar-next').hidden = !collapsed || !stepping;
  $('#r-bar-print').hidden = !collapsed;
  $('#r-save-preset').hidden = !!active;
  $('#r-delete-preset').hidden = !active;

  paper.replaceChildren(
    el('header', { className: 'report-head' },
      el('h2', { textContent: r.title }),
      el('p', { className: 'sub', textContent: `School year ${store.selectedYear()} · ${plural(r.count, 'note')} · produced ${fmt(new Date(), LONG)}` })));
  paper.classList.toggle('wide', settings.layout === 'grid');
  if (!r.groups.some(g => g.pupils.length)) {
    paper.append(el('p', { className: 'empty', textContent: r.groups.length ? 'No notes in this period.' : 'No classes in this school year.' }));
  } else if (settings.layout === 'grid' && !gridAllowed(r)) {
    paper.append(el('p', { className: 'empty', textContent: 'The pupils × days layout works for a day or a week. Choose Day or Week, or another layout.' }));
  } else if (settings.layout === 'grid') {
    paper.append(tableElement(gridModel(r), 'report-table grid'));
  } else if (settings.layout === 'pupil') {
    paper.append(byPupilElement(r));
  } else {
    paper.append(tableElement(tableModel(r), 'report-table'));
  }
  status('');
}

async function exportCsv() {
  if (!lastReport) return;
  const layout = settings.layout === 'grid' && gridAllowed(lastReport) ? 'grid' : 'table';
  const filename = safeName(`Report ${lastReport.classLabel} ${lastReport.label} (${layout}).csv`);
  try {
    status(`Saved ${await store.writeExport(filename, toCsv(exportModel(lastReport)))} in your ${store.folderName()} folder.`);
  } catch (err) {
    status(`Could not save: ${err.message}`, true);
  }
}

// Copies the report as a formatted table (for Word or Excel) with a plain-text fallback.
async function copyReport() {
  const paper = $('#r-paper');
  if (!lastReport || !paper) return;
  const body = paper.querySelector('table, .by-pupil');
  if (!body) return;
  const html = `<h2>${escapeHtml(lastReport.title)}</h2>${body.outerHTML}`;
  const plain = settings.layout === 'pupil' ? `${lastReport.title}\n\n${body.innerText}` : toTsv(exportModel(lastReport));
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })]);
    status('Copied. Paste into Excel, Word or an email.');
  } catch (err) {
    status(`Could not copy: ${err.message}`, true);
  }
}

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
