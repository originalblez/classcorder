// Feedback sheets: a class's notes from one day turned into printed feedback for each
// pupil. The teacher picks the class, the day the notes are from, and one of three
// preset layouts. A layout's section headings and guides drive the Mistral prompt.
// The teacher chooses which pupils print together; a group gets one sheet, copied for
// each member. Generating writes the sheets with Mistral and saves the set in the
// notes folder's Feedback folder, then shows it on a page of its own to edit and print.
// Options are kept in localStorage.

import * as store from './store.js';
import * as mistral from './mistral.js';
import { $, el, plural, confirmModal } from './dom.js';

const SETTINGS_KEY = 'feedback:settings';

// perPage: how many fit on an A4 sheet. Tiles are full-width strips of a fixed height
// stacked down the page, so each page holds only whole tiles, cut along the dashed lines.
// A tile's sections sit side by side.
const LAYOUTS = {
  detailed: {
    name: 'Detailed feedback', hint: 'A full page per pupil.', perPage: 1, tiles: false,
    sections: [
      { heading: 'Strengths', guide: 'What went well, with specific examples from the notes.' },
      { heading: 'Areas for development', guide: 'What to improve and how.', numbered: true },
      { heading: 'Summary', guide: 'Two or three sentences pulling the feedback together, ending with brief encouragement.' },
      { heading: 'Next step', guide: 'One concrete task to do next, built from the areas for development.' },
    ],
  },
  short: {
    name: 'Short feedback', hint: '5 tiles per page, to cut out.', perPage: 5, tiles: true,
    sections: [
      { heading: 'What went well', guide: 'What went well, in one or two short sentences.' },
      { heading: 'Even better if', guide: 'What would make it even better, in one or two short sentences.' },
    ],
  },
  grid: {
    name: 'Feedback grid', hint: '4 tiles per page, to cut out.', perPage: 4, tiles: true,
    sections: [
      { heading: 'What went well', guide: 'What went well, in one or two short sentences.' },
      { heading: 'Even better if', guide: 'What would make it even better, in one or two short sentences.' },
      { heading: 'DART task', guide: 'The task the pupil needs to do next, built from Even better if, in one or two short sentences.' },
    ],
  },
};
const PERIODS = { today: 'Today', yesterday: 'Yesterday', pick: 'Pick a date' };

const DEFAULTS = { layout: 'detailed', classId: null, heading: '', teacher: '',
  showName: true, showScore: false, scoreOutOf: 20, showFooter: true, copies: true, empty: false };

const local = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

let settings = { ...DEFAULTS, ...local.get(SETTINGS_KEY, {}) };
const layoutId = () => (LAYOUTS[settings.layout] ? settings.layout : 'detailed');
const layout = () => LAYOUTS[layoutId()];

// The teacher's name is set in Settings and shown on the sheets with the date.
export const teacherName = () => settings.teacher;
export function saveTeacherName(name) { save({ teacher: name.trim() }); }

// --- Dates (local time) ---
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => addDays(new Date(), 0);
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
};
const longDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// The notes are from one day: today, yesterday, or a picked date.
let period = 'today', picked = today(), sheetDate = today();
const notesDay = () => period === 'today' ? today() : period === 'yesterday' ? addDays(today(), -1) : picked;

// --- Who is on which sheet ---
// pupils: the class's pupils with their notes in the period. groups: [{ id, name }].
// assigned: pupil id -> group id (pupils not in it have a sheet of their own).
let pupils = [], groups = [], assigned = new Map();
let excluded = new Set();      // sheet keys left out of the printout
let loadedFor = '';            // class and dates the grouping was worked out for
let getKey = () => null;
let onRoute = () => {};           // tells the app the URL should change
let writing = false;

const noteKey = n => `${n.created_at}\u0000${n.text}`;

// A sheet is one pupil, or one group. Its key changes when the group's members do,
// so text written for one set of pupils is never shown for another.
function sheets() {
  const list = [];
  for (const g of groups) {
    const members = pupils.filter(p => assigned.get(p.id) === g.id);
    if (!members.length) continue;
    list.push({ key: `g:${members.map(p => p.id).sort().join(',')}`, group: g, members, notes: mergeNotes(members) });
  }
  for (const p of pupils) {
    if (assigned.has(p.id) || (!settings.empty && !p.notes.length)) continue;
    list.push({ key: `p:${p.id}`, group: null, members: [p], notes: p.notes });
  }
  return list;
}

// The members' notes with duplicates (the same group note saved on each) removed.
function mergeNotes(members) {
  const seen = new Map();
  for (const p of members) for (const n of p.notes) seen.set(noteKey(n), n);
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// Pupils whose notes in the period are exactly the same (a group note and nothing else)
// start out printed together.
function autoGroup() {
  groups = [];
  assigned = new Map();
  excluded = new Set();
  const bySignature = new Map();
  for (const p of pupils) {
    if (!p.notes.length) continue;
    const sig = p.notes.map(noteKey).sort().join('\u0001');
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), p]);
  }
  for (const members of bySignature.values()) {
    if (members.length < 2) continue;
    const g = { id: crypto.randomUUID(), name: `Group ${groups.length + 1}` };
    groups.push(g);
    for (const p of members) assigned.set(p.id, g.id);
  }
}

async function load() {
  const day = notesDay();
  const data = await store.notesBetween(day, addDays(day, 1));
  if (!data.classes.some(c => c.id === settings.classId)) settings.classId = data.classes[0]?.id ?? null;
  const notes = new Map();
  for (const n of data.notes) notes.set(n.pupil_id, [...(notes.get(n.pupil_id) ?? []), n]);
  pupils = data.pupils.filter(p => p.class_id === settings.classId).map(p => ({ ...p, notes: notes.get(p.id) ?? [] }));
  const signature = `${store.selectedYear()}|${settings.classId}|${isoDate(day)}`;
  if (signature !== loadedFor) {
    loadedFor = signature;
    autoGroup();
  }
  return data;
}

function save(next) {
  settings = { ...settings, ...next };
  local.set(SETTINGS_KEY, settings);
}

// --- Screen: four steps, one shown at a time ---
// 1 class, 2 the day the notes are from, 3 layout, 4 options, the sheet list and the pages.
const STEPS = ['Class', 'Notes', 'Layout', 'Sheets'];
let step = 1;
let classes = [], classPupils = new Map();   // class id -> number of pupils
let withNotes = {};                          // period -> Map(class id -> pupils with notes that day)

const shortDate = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const periodDay = p => p === 'today' ? today() : p === 'yesterday' ? addDays(today(), -1) : picked;
const periodText = () => period === 'pick' ? shortDate(notesDay()) : `${PERIODS[period]}, ${shortDate(notesDay())}`;

function goTo(n) {
  step = Math.min(4, Math.max(1, n));
  render();
  scrollTo(0, 0);
}

// reportFile: a saved set to open straight away, from the URL.
export async function show(main, apiKey, onRouteChange = () => {}, reportFile = null) {
  getKey = apiKey;
  onRoute = onRouteChange;
  report = null;
  if (reportFile) {
    try { return await openReport(await store.readReport(reportFile)); } catch {}
  }
  step = 1;
  main.replaceChildren($('#feedback-view').content.cloneNode(true));
  $('#f-year', main).textContent = `School year ${store.selectedYear()}`;
  $('#f-back', main).onclick = () => goTo(step - 1);
  $('#f-next', main).onclick = () => goTo(step + 1);
  $('#f-heading', main).oninput = e => save({ heading: e.target.value });
  $('#f-date', main).onchange = e => { sheetDate = parseDate(e.target.value) ?? today(); };
  $('#f-score-out', main).onchange = e => { save({ scoreOutOf: Math.max(1, Math.round(+e.target.value) || 20) }); render(); };
  for (const id of ['showName', 'showScore', 'showFooter', 'copies', 'empty']) {
    $(`#f-${id}`, main).onchange = e => { save({ [id]: e.target.checked }); render(); };
  }
  $('#f-generate', main).onclick = () => generate();
  refresh();
  renderSaved();
  onRoute();
}

// Pupils with at least one note on the day, per class.
async function pupilsWithNotes(day) {
  const data = await store.notesBetween(day, addDays(day, 1));
  const classOf = new Map(data.pupils.map(p => [p.id, p.class_id]));
  const counts = new Map();
  for (const id of new Set(data.notes.map(n => n.pupil_id))) {
    const c = classOf.get(id);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}

async function refresh() {
  try {
    const data = await load();
    classes = data.classes;
    classPupils = new Map();
    for (const p of data.pupils) classPupils.set(p.class_id, (classPupils.get(p.class_id) ?? 0) + 1);
    withNotes = {};
    for (const p of Object.keys(PERIODS)) withNotes[p] = await pupilsWithNotes(periodDay(p));
    render();
  } catch (err) {
    status(`Could not read the notes: ${err.message}`, true);
  }
}

function status(text, error = false) {
  const s = $('#f-status');
  if (!s) return;
  s.textContent = text;
  s.className = error ? 'status error' : 'status';
}

function choice({ title, sub, sub2, selected, onclick, extra }) {
  const b = el('button', { type: 'button', className: `choice${selected ? ' selected' : ''}`, onclick });
  b.setAttribute('aria-pressed', selected);
  if (extra) b.append(extra);
  b.append(el('strong', { textContent: title }), el('span', { className: 'choice-sub', textContent: sub }));
  if (sub2) b.append(el('span', { className: 'choice-sub', textContent: sub2 }));
  return b;
}

// A small drawing of an A4 page in the layout.
function miniPage(l) {
  const page = el('div', { className: `mini mini-${l.tiles ? 'tiles' : 'page'}` });
  for (let i = 0; i < l.perPage; i++) {
    const tile = el('div', { className: 'mini-tile' });
    for (let j = 0; j < l.sections.length; j++) tile.append(el('i'));
    page.append(tile);
  }
  return page;
}

function renderStepper() {
  const values = [classes.find(c => c.id === settings.classId)?.name ?? '', periodText(), layout().name, ''];
  $('#f-stepper').replaceChildren(...STEPS.map((label, i) => {
    const n = i + 1;
    const b = el('button', { type: 'button', onclick: () => goTo(n), disabled: !classes.length && n > 1 },
      el('span', { className: 'step-num', textContent: n }),
      el('span', { className: 'step-label' }, el('span', { textContent: label }),
        el('span', { className: 'step-value', textContent: n < step ? values[i] : '' })));
    if (n === step) b.setAttribute('aria-current', 'step');
    return el('li', { className: n === step ? 'current' : n < step ? 'done' : '' }, b);
  }));
}

function renderStep() {
  if (step === 1) {
    const box = $('#f-classes');
    if (!classes.length) {
      box.replaceChildren(el('p', { className: 'step-sub', textContent: 'There are no classes in this school year yet.' }));
      return;
    }
    box.replaceChildren(...classes.map(c => choice({
      title: c.name,
      sub: `${plural(classPupils.get(c.id) ?? 0, 'pupil')} · ${withNotes.today?.get(c.id) ?? 0} with notes today`,
      selected: c.id === settings.classId,
      onclick: async () => { save({ classId: c.id }); await refresh(); goTo(2); },
    })));
  } else if (step === 2) {
    $('#f-periods').replaceChildren(...Object.entries(PERIODS).map(([p, label]) => {
      const n = withNotes[p]?.get(settings.classId) ?? 0;
      const sub = p === 'pick' && period !== 'pick' ? 'Choose any day' : `${shortDate(periodDay(p))} · ${n ? plural(n, 'pupil') : 'no pupils'} with notes`;
      return choice({
        title: label, sub, selected: p === period,
        onclick: async () => {
          period = p;
          await refresh();
          if (p === 'pick') $('#f-date-pick')?.showPicker?.();
          else goTo(3);
        },
      });
    }));
    if (period === 'pick') {
      const input = el('input', { type: 'date', id: 'f-date-pick', value: isoDate(picked), max: isoDate(today()) });
      input.setAttribute('aria-label', 'Day the notes are from');
      input.onchange = async () => { picked = parseDate(input.value) ?? today(); await refresh(); };
      $('#f-periods').append(el('label', { className: 'field-dark pick-date' }, 'Day', input));
    }
  } else if (step === 3) {
    $('#f-layouts').replaceChildren(...Object.entries(LAYOUTS).map(([id, l]) => choice({
      title: l.name,
      sub: l.sections.map(x => x.heading).join(' · '),
      sub2: l.hint,
      selected: id === layoutId(),
      extra: miniPage(l),
      onclick: () => { save({ layout: id }); goTo(4); },
    })));
  } else {
    $('#f-date').value = isoDate(sheetDate);
    $('#f-heading').value = settings.heading;
    $('#f-teacher-note').textContent = settings.teacher ? `Your name: ${settings.teacher}. Change it in Settings.` : 'Set your name in Settings to show it on the sheets.';
    $('#f-score-out').value = settings.scoreOutOf;
    $('#f-score-out-label').classList.toggle('off', !settings.showScore);
    $('#f-score-out').disabled = !settings.showScore;
    for (const id of ['showName', 'showScore', 'showFooter', 'copies', 'empty']) $(`#f-${id}`).checked = settings[id];
  }
}

function render() {
  if (!$('#f-wizard')) return;
  for (const s of document.querySelectorAll('#f-wizard .step')) s.hidden = +s.dataset.step !== step;
  renderStepper();
  renderStep();
  $('#f-back').hidden = step === 1;
  $('#f-next').hidden = step === 4;
  $('#f-next').disabled = !classes.length;
  $('#f-generate').hidden = step !== 4;
  if (step === 4) {
    renderSheetList();
    renderGenerate();
  }
}

// --- The list of sheets: who prints on their own and who prints together ---
function renderSheetList() {
  const box = $('#f-sheets');
  const all = sheets();
  box.replaceChildren();
  if (!pupils.length) {
    box.append(el('p', { className: 'option-note', textContent: 'This class has no pupils.' }));
    return;
  }
  if (!all.length) {
    box.append(el('p', { className: 'option-note', textContent: 'No notes on this day. Go back and pick another day, or tick "Pupils with no notes" to fill the sheets in by hand.' }));
    return;
  }

  const moveSelect = p => {
    const select = el('select', { className: 'f-move', title: 'Print on their own, or together with others' });
    select.append(el('option', { value: '', textContent: 'Own sheet' }),
      ...groups.map(g => el('option', { value: g.id, textContent: g.name })),
      el('option', { value: 'new', textContent: 'New group…' }));
    select.value = assigned.get(p.id) ?? '';
    select.onchange = () => {
      if (select.value === 'new') {
        const g = { id: crypto.randomUUID(), name: `Group ${groups.length + 1}` };
        groups.push(g);
        assigned.set(p.id, g.id);
      } else if (select.value) assigned.set(p.id, select.value);
      else assigned.delete(p.id);
      groups = groups.filter(g => [...assigned.values()].includes(g.id));
      render();
    };
    return select;
  };
  const noteText = s => (s.notes.length ? plural(s.notes.length, 'note') : 'No notes');
  const include = s => {
    const box = el('input', { type: 'checkbox', checked: !excluded.has(s.key), title: 'Include this sheet' });
    box.onchange = () => { box.checked ? excluded.delete(s.key) : excluded.add(s.key); renderGenerate(); };
    return box;
  };

  for (const s of all) {
    if (s.group) {
      const name = el('input', { className: 'f-group-name', value: s.group.name, title: 'Group name' });
      name.setAttribute('aria-label', 'Group name');
      name.oninput = () => { s.group.name = name.value; };
      name.onchange = () => renderSheetList();
      const block = el('div', { className: 'f-group' },
        el('div', { className: 'f-row f-group-head' }, include(s), name,
          el('span', { className: 'f-state', textContent: `${plural(s.members.length, 'pupil')} · ${noteText(s)}` })));
      for (const p of s.members) {
        block.append(el('div', { className: 'f-row f-member' }, el('span', { className: 'f-name', textContent: p.name }), moveSelect(p)));
      }
      box.append(block);
    } else {
      const p = s.members[0];
      box.append(el('div', { className: 'f-row' }, include(s), el('span', { className: 'f-name', textContent: p.name }),
        el('span', { className: 'f-state', textContent: noteText(s) }), moveSelect(p)));
    }
  }
}

function renderGenerate() {
  const n = sheets().filter(s => !excluded.has(s.key)).length;
  const b = $('#f-generate');
  if (!b) return;
  b.disabled = writing || !n;
  b.textContent = writing ? 'Generating…' : n ? `Generate ${plural(n, 'sheet')}` : 'Generate sheets';
}

// --- Generating: write every ticked sheet, save the set, then open it ---
async function generate() {
  if (writing) return;
  const l = layout();
  const list = sheets().filter(s => !excluded.has(s.key));
  if (!list.length) return;
  const todo = list.filter(s => s.notes.length);
  const key = getKey();
  if (todo.length && !key) { status('Connect Mistral in Settings to write the sheets.', true); return; }
  writing = true;
  renderGenerate();
  const texts = new Map();
  let done = 0, cost = 0, failed = 0;
  try {
    for (const s of todo) {
      status(`Writing ${done + 1} of ${todo.length}…`);
      try {
        const out = await mistral.writeFeedback(key, l.sections, s.notes, { group: s.members.length > 1 });
        texts.set(s.key, out.sections);
        cost += out.cost;
      } catch (err) {
        if (err instanceof mistral.ApiKeyError) throw err;
        failed++;
      }
      done++;
    }
    const report = buildReport(list, texts, cost);
    status('Saving…');
    if (!$('#f-wizard')) return;
    openReport(report, failed
      ? `${plural(failed, 'sheet')} could not be written. Type into ${failed === 1 ? 'it' : 'them'} directly.`
      : '');
  } catch (err) {
    status(err.message, true);
  } finally {
    writing = false;
    renderGenerate();
  }
}

const fileSafe = s => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

function buildReport(list, texts, cost) {
  const klass = classes.find(c => c.id === settings.classId);
  const now = new Date();
  const day = notesDay();
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return {
    app: 'classcorder-feedback', version: 1,
    file: fileSafe(`${isoDate(day)} ${klass?.name ?? 'Class'} ${layout().name} ${time}`),
    school_year: store.selectedYear(),
    created_at: now.toISOString(),
    class_name: klass?.name ?? '',
    notes_day: isoDate(day),
    layout: layoutId(),
    cost_usd: cost,
    heading: settings.heading,
    teacher: settings.teacher,
    sheet_date: isoDate(sheetDate),
    show_name: settings.showName,
    show_score: settings.showScore,
    score_out_of: settings.scoreOutOf,
    show_footer: settings.showFooter,
    copies: settings.copies,
    sheets: list.map(s => ({
      group: s.group?.name ?? null,
      members: s.members.map(p => p.name),
      sections: { ...(texts.get(s.key) ?? {}) },
      score: '',
    })),
  };
}

// --- Saved sets ---
async function renderSaved() {
  const box = $('#f-saved');
  if (!box) return;
  let list = [];
  try { list = await store.listReports(); } catch {}
  if (!$('#f-saved')) return;
  box.hidden = !list.length;
  $('#f-saved-sub').textContent = `Saved in the ${store.reportsFolder()} folder inside ${store.folderName()}. Each set is also a web page you can open and print on its own.`;
  $('#f-saved-list').replaceChildren(...list.map(r => {
    const open = el('button', { type: 'button', className: 'saved-open' },
      el('strong', { textContent: `${r.class_name} · ${LAYOUTS[r.layout]?.name ?? r.layout}` }),
      el('span', { textContent: `Notes from ${shortDate(parseDate(r.notes_day))} · ${plural(r.sheets.length, 'sheet')} · made ${new Date(r.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` }));
    open.onclick = () => openReport(r);
    const del = el('button', { type: 'button', className: 'link-button danger', textContent: 'Delete' });
    del.onclick = async () => {
      if (!(await confirmModal({ title: 'Delete these sheets?', text: `Removes ${r.file}.html and .json from the ${store.reportsFolder()} folder.`, confirmLabel: 'Delete', danger: true }))) return;
      await store.deleteReport(r.file);
      renderSaved();
    };
    return el('li', {}, open, del);
  }));
}

// --- A generated set, on its own page ---
let report = null;
let saveTimer = null;

export const openReportFile = () => report?.file ?? null;

async function openReport(r, note = '') {
  report = r;
  const main = $('#main');
  main.replaceChildren($('#report-view').content.cloneNode(true));
  const l = LAYOUTS[r.layout] ?? LAYOUTS.detailed;
  $('#r-title').textContent = `${r.class_name} · ${l.name}`;
  $('#r-sub').textContent = `Notes from ${longDate(parseDate(r.notes_day))} · ${plural(r.sheets.length, 'sheet')}`;
  $('#r-back').onclick = () => { flushSave(); report = null; show(main, getKey, onRoute); };
  $('#r-print').onclick = () => window.print();
  renderReport();
  scrollTo(0, 0);
  onRoute();
  await saveReport(note);
}

function reportStatus(text, error = false) {
  const s = $('#r-status');
  if (!s) return;
  s.textContent = text;
  s.className = error ? 'report-status error' : 'report-status';
}

// Edits are saved a moment after typing stops.
function scheduleSave() {
  clearTimeout(saveTimer);
  reportStatus('Saving…');
  saveTimer = setTimeout(() => saveReport(), 800);
}
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveReport();
}

async function saveReport(note = '') {
  saveTimer = null;
  if (!report || !$('#r-paper')) return;
  try {
    const path = await store.saveReport(report, printableHtml(report));
    reportStatus(`${note ? `${note} ` : ''}Saved as ${path}. Click any text to edit it.`, !!note);
  } catch (err) {
    reportStatus(`Could not save: ${err.message}`, true);
  }
}

// A self-contained page of the sheets, styled with the app's own sheet rules.
function printableHtml(r) {
  const paper = $('#r-paper').cloneNode(true);
  paper.removeAttribute('id');
  for (const e of paper.querySelectorAll('[contenteditable]')) e.removeAttribute('contenteditable');
  for (const e of paper.querySelectorAll('.overflow')) e.classList.remove('overflow');
  for (const e of paper.querySelectorAll('.fb-body:empty')) e.removeAttribute('data-placeholder');
  const css = [];
  const sheetRule = text => /\.fb-|\.layout-|@page/.test(text);
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) {
        const inner = [...rule.cssRules].map(x => x.cssText).filter(sheetRule);
        if (inner.length) css.push(`@media ${rule.media.mediaText} {\n${inner.join('\n')}\n}`);
      } else if (rule.selectorText && sheetRule(rule.selectorText)) css.push(rule.cssText);
    }
  }
  const title = `${r.class_name} · ${(LAYOUTS[r.layout] ?? LAYOUTS.detailed).name} · ${r.notes_day}`;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body { margin: 0; padding: 24px 0; background: #f2f2f5; }
@media print { body { padding: 0; background: #fff; } }
${css.join('\n')}
</style>
</head>
<body>
${paper.outerHTML}
</body>
</html>
`;
}

// Section text: paragraphs, or a numbered list where lines start "1.". A "Label:" at
// the start of a numbered point is shown in bold.
function formatInto(box, text) {
  box.replaceChildren();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let list = null;
  for (const line of lines) {
    const m = /^\d+[.)]\s+(.*)$/.exec(line);
    if (m) {
      list ??= box.appendChild(el('ol'));
      const label = /^([^:]{1,40}):\s+(.*)$/.exec(m[1]);
      list.append(label ? el('li', {}, el('strong', { textContent: `${label[1]}: ` }), label[2]) : el('li', { textContent: m[1] }));
    } else {
      list = null;
      box.append(el('p', { textContent: line }));
    }
  }
}

// An editable section body: formatted when shown, plain text while being edited.
function sectionBody(entry, heading) {
  const body = el('div', { className: 'fb-body', contentEditable: 'true', spellcheck: true });
  const text = () => entry.sections[heading] ?? '';
  if (text()) formatInto(body, text());
  body.dataset.placeholder = 'Type here';
  body.onfocus = () => { body.textContent = text(); body.classList.add('editing'); };
  body.oninput = () => {
    entry.sections[heading] = body.innerText.replace(/\n{3,}/g, '\n\n').trim();
    scheduleSave();
  };
  body.onblur = () => {
    body.classList.remove('editing');
    renderReport();
    flushSave();
  };
  return body;
}

// One pupil's feedback: a full page, or a tile with its sections side by side. Every
// tile carries the teacher's name and date, so it still makes sense once cut out;
// a detailed sheet has them once at the foot of the page.
function cell(r, l, entry, name) {
  const c = el('section', { className: 'fb-cell' });
  if (!l.tiles && r.heading) c.append(el('h1', { className: 'fb-title', textContent: r.heading }));
  const shownName = r.show_name ? name : '';
  if (shownName || r.show_score) {
    const head = el('div', { className: 'fb-name-row' });
    head.append(el('h2', { className: 'fb-name', textContent: shownName }));
    if (r.show_score) {
      const score = el('span', { className: 'fb-score-value', contentEditable: 'true', textContent: entry.score });
      score.oninput = () => { entry.score = score.textContent.trim(); scheduleSave(); };
      score.onblur = () => { renderReport(); flushSave(); };
      head.append(el('span', { className: 'fb-score' }, 'Score ', score, ` / ${r.score_out_of}`));
    }
    c.append(head);
  }
  const box = l.tiles ? c.appendChild(el('div', { className: 'fb-cols' })) : c;
  for (const section of l.sections) {
    box.append(el('div', { className: 'fb-section' },
      el('h3', { className: 'fb-heading', textContent: section.heading }), sectionBody(entry, section.heading)));
  }
  if (r.show_footer) {
    c.append(el('footer', { className: 'fb-footer' },
      el('span', { textContent: r.teacher }), el('span', { textContent: longDate(parseDate(r.sheet_date) ?? today()) })));
  }
  return c;
}

function renderReport() {
  const paper = $('#r-paper');
  if (!paper || !report) return;
  const r = report;
  const l = LAYOUTS[r.layout] ?? LAYOUTS.detailed;
  const { perPage } = l;
  paper.className = `fb-pages layout-${LAYOUTS[r.layout] ? r.layout : 'detailed'}`;
  paper.style.setProperty('--per-page', perPage);
  paper.replaceChildren();

  // Cells in print order. On tile layouts each group starts a page of its own,
  // so its tiles can be cut and handed out together.
  const runs = [];
  let loose = [];
  for (const s of r.sheets) {
    const names = s.group && r.copies ? s.members : [s.group ? s.members.join(', ') : s.members[0]];
    const cells = names.map(name => ({ s, name }));
    if (s.group && perPage > 1) {
      if (loose.length) { runs.push({ cells: loose }); loose = []; }
      runs.push({ cells, group: s.group });
    } else loose.push(...cells);
  }
  if (loose.length) runs.push({ cells: loose });

  // Each page has perPage equal rows, so tiles are the same height on every page,
  // including a part-filled last one. Tile pages always have the heading strip.
  for (const run of runs) {
    for (let i = 0; i < run.cells.length; i += perPage) {
      const page = el('div', { className: 'fb-page' });
      if (perPage > 1) {
        page.append(el('header', { className: 'fb-page-head' },
          el('span', { textContent: r.heading }), el('span', { textContent: run.group ?? '' })));
      }
      const grid = el('div', { className: 'fb-grid' });
      for (const { s, name } of run.cells.slice(i, i + perPage)) grid.append(cell(r, l, s, name));
      page.append(grid);
      paper.append(page);
    }
  }

  // Tiles have a fixed size: flag any whose text runs past the bottom.
  requestAnimationFrame(() => {
    for (const c of paper.querySelectorAll('.fb-cell')) c.classList.toggle('overflow', c.scrollHeight > c.clientHeight + 1);
  });
}
