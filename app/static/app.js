import { $, el, plural, openModal, confirmModal, notice } from './dom.js';
import * as reports from './reports.js';
import * as store from './store.js';
import * as mistral from './mistral.js';
import { loadKey, saveKey, forgetKey } from './key.js';


let apiKey = null;
let current = null;      // selected pupil
let view = null;         // 'reports' or 'settings' while that screen is open
let yearCollapsed = false;
let recorder = null, busy = false;
// The note being drafted: raw transcripts of each recording and their estimated cost.
let draftTranscripts = [], draftCost = 0;

const recording = () => busy || recorder?.state === 'recording';
const hasUnsavedDraft = () => !!$('#draft')?.value.trim();
const okToLeaveDraft = async () => !recording() && (!hasUnsavedDraft() || confirmModal({
  title: 'Discard the unsaved note?',
  text: 'The note you are writing hasn\'t been saved.',
  confirmLabel: 'Discard note', cancelLabel: 'Keep editing', danger: true,
}));

// Pupils with no note for this many days are marked on the class roster.
const QUIET_DAYS = 14;

// The class roster column, shown beside the main screen while a pupil is open.
function closeRoster() {
  $('#roster').hidden = true;
  $('.layout').classList.remove('with-roster');
}

function showRoster(p, classes) {
  const roster = $('#roster');
  const klass = classes.find(c => c.id === p.class_id);
  if (!klass) { closeRoster(); return; }
  roster.replaceChildren();
  roster.append(el('h3', { textContent: klass.name }));
  // Only the current year marks pupils without a recent note; for past years it means nothing.
  const since = Date.now() - QUIET_DAYS * 864e5;
  const ul = el('ul');
  for (const q of klass.pupils) {
    const quiet = store.isCurrentYear() && (!q.last || new Date(q.last) < since);
    const b = el('button', { className: (q.id === p.id ? 'active' : '') + (quiet ? ' quiet' : '') },
      el('span', { className: 'label', textContent: q.name }),
      el('span', { className: 'count', textContent: q.notes || '' }));
    b.title = quiet ? `No note in the last ${QUIET_DAYS} days` : '';
    b.onclick = () => selectPupil({ ...q, className: klass.name });
    ul.append(el('li', {}, b));
  }
  roster.append(ul);
  if (store.isCurrentYear()) {
    const edit = el('button', { className: 'roster-edit', textContent: 'Edit class' });
    edit.onclick = () => openClassModal(klass);
    roster.append(edit);
  }
  roster.hidden = false;
  $('.layout').classList.add('with-roster');
}

// --- Folder ---
function showFolderForm(needsPermission) {
  current = null;
  closeRoster();
  $('#main').replaceChildren($('#folder-view').content.cloneNode(true));
  $('#folder-hint').hidden = !needsPermission;
  $('#folder-button').textContent = needsPermission ? 'Allow access' : 'Choose folder';
  $('#folder-button').onclick = async () => {
    const status = $('#folder-status');
    status.className = 'status';
    status.textContent = needsPermission ? 'Waiting for permission…' : 'Opening folder picker…';
    try {
      await (needsPermission ? store.reconnectFolder() : store.chooseFolder());
      folderReady();
    } catch (err) {
      console.error('Folder selection failed', err);
      status.className = 'status error';
      status.textContent = err.name === 'AbortError' ? `No folder chosen (${err.message})` : `${err.name}: ${err.message}`;
    }
  };
}

async function folderReady() {
  apiKey = await loadKey();
  if (apiKey) showHome();
  else showKeyForm();
}

async function changeFolder() {
  if (!(await okToLeaveDraft())) return;
  try {
    await store.chooseFolder();
    current = null;
    folderReady();
  } catch (err) {
    if (err.name !== 'AbortError') notice('Could not change folder', err.message);
  }
}

// --- API key ---
function showKeyForm() {
  current = null;
  view = null;
  closeRoster();
  saveRoute();
  refreshSidebar();
  $('#main').replaceChildren($('#key-view').content.cloneNode(true));
  $('#key-form').onsubmit = async e => {
    e.preventDefault();
    const value = $('#key-input').value.trim();
    const status = $('#key-status');
    $('#key-save').disabled = true;
    status.className = 'status';
    status.textContent = 'Checking…';
    try {
      await mistral.checkKey(value);
      await saveKey(value);
      apiKey = value;
      showHome();
    } catch (err) {
      status.className = 'status error';
      status.textContent = err.message;
    } finally {
      $('#key-save') && ($('#key-save').disabled = false);
    }
  };
  $('#key-input').focus();
}

async function forgetApiKey() {
  if (recording()) return;
  if (!(await confirmModal({
    title: 'Forget the API key?',
    text: 'This tab stops using the key. It stays in the browser\'s password manager unless you delete it there.',
    confirmLabel: 'Forget key',
  }))) return;
  forgetKey();
  apiKey = null;
  showKeyForm();
}

// --- Main area when no pupil is selected ---
function emptyCard(title, text, label, onclick) {
  const card = el('div', { className: 'card key-card' }, el('h2', { textContent: title }), el('p', { textContent: text }));
  if (label) {
    const b = el('button', { className: 'btn primary', textContent: label });
    b.onclick = onclick;
    card.append(b);
  }
  return card;
}

async function showEmpty() {
  current = null;
  view = null;
  closeRoster();
  saveRoute();
  const main = $('#main');
  const year = store.selectedYear();
  const thisYear = store.schoolYearFor();
  if (!year || (!store.isCurrentYear() && !(await store.listYears()).includes(thisYear))) {
    main.replaceChildren(emptyCard(`Start school year ${thisYear}`,
      'Set up this year\'s classes and pupils to start recording notes.', 'Start school year', openYearModal));
  } else if (store.isCurrentYear() && !(await store.listTree()).length) {
    main.replaceChildren(emptyCard('Add your first class',
      'Give the class a name and add its pupils. You can paste a list of names.', 'Add class', () => openClassModal()));
  } else {
    main.replaceChildren(el('p', { className: 'empty', textContent: store.isCurrentYear()
      ? 'Choose a class, or find a pupil, to record a note.' : `Viewing ${year}. Choose a class to see its pupils' notes.` }));
  }
}

// The URL hash records the school year and pupil on screen, so a refresh returns to them.
// It holds only IDs, never pupil names, as URLs end up in browser history.
function saveRoute() {
  const params = new URLSearchParams();
  if (store.selectedYear()) params.set('year', store.selectedYear());
  if (current) params.set('pupil', current.id);
  if (view === 'reports') {
    params.set('view', 'reports');
    for (const [k, v] of reports.routeParams()) params.set(k, v);
  }
  if (view === 'settings') params.set('view', 'settings');
  $('#nav-reports').classList.toggle('active', view === 'reports');
  $('#nav-settings').classList.toggle('active', view === 'settings');
  history.replaceState(null, '', params.size ? `#${params}` : location.pathname);
}

// Opens the year and pupil in the URL. Returns true if a pupil was opened.
async function restoreRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const year = params.get('year');
  if (year && (await store.listYears()).includes(year)) await store.selectYear(year);
  if (params.get('view') === 'reports' && store.selectedYear()) {
    reports.restoreRoute(params);
    showReports();
    return true;
  }
  if (params.get('view') === 'settings') {
    showSettings();
    return true;
  }
  if (params.get('view') === 'class' && (await store.listTree()).some(c => c.id === params.get('class'))) {
    await openClass(params.get('class'));
    return true;
  }
  const id = params.get('pupil');
  if (!id) return false;
  for (const c of await store.listTree()) {
    const p = c.pupils.find(p => p.id === id);
    if (p) {
      selectPupil({ ...p, className: c.name });
      return true;
    }
  }
  return false;
}

let routeRestored = false;

async function showHome() {
  let restored = false;
  if (!routeRestored) {
    routeRestored = true;
    restored = await restoreRoute().catch(() => false);
  }
  if (!restored) await showEmpty();
  refreshSidebar();
}

// --- Sidebar: school year → class ---
let tree = [];  // the selected year's classes with their pupils, for the sidebar and Find pupil

async function refreshSidebar() {
  const nav = $('#tree');
  $('#add-class').hidden = true;
  $('#nav-reports').hidden = true;
  $('#find-box').hidden = true;
  $('#nav-settings').hidden = !store.folderName();
  if (!store.folderName() || !apiKey) { tree = []; nav.replaceChildren(); return; }
  try {
    const thisYear = store.schoolYearFor();
    const years = await store.listYears();
    const selected = store.selectedYear();
    tree = selected ? await store.listTree() : [];
    const ul = el('ul');
    if (!years.includes(thisYear)) {
      const start = el('button', { className: 'node-button add', textContent: `+ Start ${thisYear}` });
      start.onclick = openYearModal;
      ul.append(el('li', {}, el('div', { className: 'node' }, start)));
    }
    for (const y of years) {
      const open = y === selected && !yearCollapsed;
      const row = el('button', { className: 'node-button year' },
        el('span', { className: 'caret' }), el('span', { className: 'label', textContent: y }));
      if (y === thisYear) row.append(el('span', { className: 'tag', textContent: 'current' }));
      row.setAttribute('aria-expanded', open);
      row.onclick = () => chooseYear(y);
      const li = el('li', {}, el('div', { className: 'node' }, row));
      if (open) li.append(classList());
      ul.append(li);
    }
    nav.replaceChildren(ul);
    $('#nav-reports').hidden = !selected;
    $('#find-box').hidden = !tree.some(c => c.pupils.length);
    // Classes can only be added to the current year.
    $('#add-class').hidden = !store.isCurrentYear();
    $('#add-class').textContent = `+ Add class to ${thisYear}`;
  } catch (err) {
    notice('Could not read the data file', err.message);
  }
}

function classList() {
  const ul = el('ul', { className: 'branch' });
  for (const c of tree) {
    const b = el('button', { className: 'node-button klass' },
      el('span', { className: 'label', textContent: c.name }), el('span', { className: 'count', textContent: c.pupils.length }));
    b.dataset.class = c.id;
    b.onclick = () => openClass(c.id);
    ul.append(el('li', {}, b));
  }
  if (!tree.length) ul.append(el('li', { className: 'empty', textContent: 'No classes.' }));
  return ul;
}

// Highlights the open pupil, and its class, in the sidebar.
function markActive() {
  for (const b of document.querySelectorAll('#tree [data-pupil]')) b.classList.toggle('active', b.dataset.pupil === current?.id);
  for (const b of document.querySelectorAll('#tree [data-class]')) b.classList.toggle('active', b.dataset.class === current?.class_id);
}

async function chooseYear(y) {
  if (y === store.selectedYear()) {
    yearCollapsed = !yearCollapsed;
    refreshSidebar();
    return;
  }
  if (!(await okToLeaveDraft())) return;
  await store.selectYear(y);
  yearCollapsed = false;
  if (view === 'reports') showReports();
  else if (view === 'settings') showSettings();
  else await showEmpty();
  refreshSidebar();
}

// --- Opening a class: its first pupil, with the class roster alongside ---
async function openClass(id) {
  if (current?.class_id === id) return;  // already in this class: nothing to do
  if (!(await okToLeaveDraft())) return;
  const klass = (await store.listTree()).find(c => c.id === id);
  if (!klass) { await showEmpty(); return; }
  if (!klass.pupils.length) {
    // There is nothing to show: go straight to adding the pupils.
    store.isCurrentYear() ? openClassModal(klass)
      : notice('No pupils', `${klass.name} has no pupils recorded for ${store.selectedYear()}.`);
    return;
  }
  selectPupil({ ...klass.pupils[0], className: klass.name });
}

// --- Find pupil (sidebar search; press / to focus it) ---
const find = $('#find'), findResults = $('#find-results');
let matches = [], highlighted = 0;

// Names starting with the text come first, then a later word starting with it, then any match.
function findMatches(text) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const rank = name => {
    const n = name.toLowerCase();
    return n.startsWith(q) ? 0 : n.split(/\s+/).some(w => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1;
  };
  return tree.flatMap(c => c.pupils.map(p => ({ ...p, className: c.name, rank: rank(p.name) })))
    .filter(p => p.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function renderFind() {
  matches = findMatches(find.value);
  highlighted = Math.min(highlighted, Math.max(matches.length - 1, 0));
  const open = document.activeElement === find && !!find.value.trim();
  findResults.hidden = !open;
  find.setAttribute('aria-expanded', open);
  findResults.replaceChildren(...(matches.length ? matches.map((p, i) => {
    const li = el('li', { role: 'option', className: i === highlighted ? 'highlighted' : '' },
      el('span', { className: 'label', textContent: p.name }), el('span', { className: 'count', textContent: p.className }));
    li.setAttribute('aria-selected', i === highlighted);
    li.onmousedown = e => { e.preventDefault(); pickFound(p); };
    return li;
  }) : [el('li', { className: 'none', textContent: 'No pupils match' })]));
}

function pickFound(p) {
  find.value = '';
  find.blur();
  selectPupil(p);
}

find.oninput = () => { highlighted = 0; renderFind(); };
find.onfocus = renderFind;
find.onblur = () => { findResults.hidden = true; find.setAttribute('aria-expanded', false); };
find.onkeydown = e => {
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
    e.preventDefault();
    highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    renderFind();
  } else if (e.key === 'Enter' && matches[highlighted]) {
    e.preventDefault();
    pickFound(matches[highlighted]);
  } else if (e.key === 'Escape') {
    find.value = '';
    find.blur();
  }
};
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || $('#find-box').hidden) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  find.focus();
});

// --- Reports ---
function showReports() {
  if (!store.selectedYear()) return;
  current = null;
  view = 'reports';
  closeRoster();
  markActive();
  reports.show($('#main'), saveRoute);
  saveRoute();
}

$('#nav-reports').onclick = async () => {
  if (view === 'reports' || !(await okToLeaveDraft())) return;
  showReports();
};

// --- Settings ---
function showSettings() {
  current = null;
  view = 'settings';
  closeRoster();
  markActive();
  $('#main').replaceChildren($('#settings-view').content.cloneNode(true));
  const year = store.selectedYear();
  $('#s-folder').textContent = store.folderName();
  $('#s-change-folder').onclick = changeFolder;
  $('#s-export-text').textContent = year
    ? `Saves every class, pupil and note for ${year} as a spreadsheet file in the Exports folder.`
    : 'Start a school year first.';
  $('#s-export-all').disabled = !year;
  $('#s-export-all').onclick = exportAll;
  refreshSpend();
  const key = $('#s-key');
  key.textContent = apiKey ? 'Forget API key' : 'Connect';
  key.onclick = apiKey ? forgetApiKey : showKeyForm;
  saveRoute();
}

$('#nav-settings').onclick = async () => {
  if (view === 'settings' || !(await okToLeaveDraft())) return;
  showSettings();
};

// --- Modals ---
const modal = $('#modal');
$('#add-class').onclick = () => openClassModal();

async function openYearModal() {
  const thisYear = store.schoolYearFor();
  const previous = (await store.listYears()).find(y => y < thisYear);
  const m = openModal('year-modal');
  $('h2', m).textContent = `Start school year ${thisYear}`;
  $('#y-copy-row', m).hidden = !previous;
  $('#y-copy-title', m).textContent = `Copy classes and pupils from ${previous}`;
  $('form', m).onsubmit = async e => {
    e.preventDefault();
    if (!(await okToLeaveDraft())) return;
    try {
      await store.startCurrentYear(previous && $('#y-copy', m).checked ? previous : null);
      modal.close();
      yearCollapsed = false;
      showHome();
    } catch (err) {
      $('#y-error', m).textContent = err.message;
    }
  };
}

// klass: a class from listTree (with pupils), or nothing to add a new one.
function openClassModal(klass = null) {
  if (!store.isCurrentYear()) return;
  const m = openModal('class-modal');
  $('h2', m).textContent = klass ? `Edit ${klass.name}` : 'Add class';
  $('#m-sub', m).textContent = `School year ${store.selectedYear()}`;
  const name = $('#m-name', m);
  name.value = klass?.name ?? '';
  const add = $('#m-add', m);
  const error = $('#m-error', m);
  const rows = (klass?.pupils ?? []).map(p => ({ id: p.id, name: p.name, notes: p.notes, removed: false }));

  // Pasted spreadsheet rows may hold several cells; they're joined with spaces.
  const newNames = () => add.value.split(/\r?\n/).map(line => line.split('\t').map(s => s.trim()).filter(Boolean).join(' ')).filter(Boolean);
  add.oninput = () => {
    const n = newNames().length;
    $('#m-add-count', m).textContent = n ? plural(n, 'name') : '';
  };

  function renderRows() {
    $('#m-pupils-section', m).hidden = !rows.length;
    const kept = rows.filter(r => !r.removed);
    $('#m-count', m).textContent = rows.length ? `(${kept.length})` : '';
    $('#m-pupils', m).replaceChildren(...rows.map(r => {
      const input = el('input', { value: r.name, disabled: r.removed, autocomplete: 'off' });
      input.setAttribute('aria-label', 'Pupil name');
      input.oninput = () => { r.name = input.value; };
      const toggle = el('button', { type: 'button', className: 'icon', textContent: r.removed ? 'Undo' : '✕',
        title: r.removed ? `Keep ${r.name}` : `Remove ${r.name}` });
      toggle.onclick = () => { r.removed = !r.removed; renderRows(); };
      return el('li', { className: r.removed ? 'removed' : '' }, input, toggle);
    }));
    const gone = rows.filter(r => r.removed);
    const notes = gone.reduce((sum, r) => sum + r.notes, 0);
    $('#m-summary', m).textContent = gone.length
      ? `Saving removes ${gone.map(r => r.name).join(', ')}${notes ? ` and deletes ${plural(notes, 'note')}` : ''}.`
      : '';
  }
  renderRows();

  const del = $('#m-delete', m);
  del.hidden = !klass;
  del.onclick = async () => {
    const notes = rows.reduce((sum, r) => sum + r.notes, 0);
    if (!(await confirmModal({
      title: `Delete ${klass.name}?`,
      text: `This deletes the class, its ${plural(rows.length, 'pupil')} and ${plural(notes, 'note')} for ${store.selectedYear()}. This can't be undone.`,
      confirmLabel: 'Delete class', danger: true,
    }))) return;
    if (rows.some(r => r.id === current?.id) && !(await okToLeaveDraft())) return;
    try {
      await store.deleteClass(klass.id);
      modal.close();
      if (rows.some(r => r.id === current?.id)) await showEmpty();
      refreshSidebar();
    } catch (err) { error.textContent = err.message; }
  };

  $('form', m).onsubmit = async e => {
    e.preventDefault();
    error.textContent = '';
    const removed = rows.filter(r => r.removed).map(r => r.id);
    if (removed.includes(current?.id) && !(await okToLeaveDraft())) return;
    try {
      const saved = await store.saveClass({
        id: klass?.id,
        name: name.value,
        pupils: [...rows.filter(r => !r.removed).map(r => ({ id: r.id, name: r.name })), ...newNames().map(n => ({ name: n }))],
        removed,
      });
      modal.close();
      // The pupil being viewed may have been removed or renamed with the class.
      if (removed.includes(current?.id)) await showEmpty();
      else if (!hasUnsavedDraft()) await openClass(saved.id);
      refreshSidebar();
      // Still in the saved class: redraw the roster, as names and counts may have changed.
      if (current?.class_id === saved.id && !$('#roster').hidden) showRoster(current, tree);
    } catch (err) {
      error.textContent = err.message;
    }
  };
  name.focus();
}

// --- Pupil view ---
function setStatus(text, error = false) {
  const s = $('#status');
  if (!s) return;
  s.textContent = text;
  s.className = error ? 'status error' : 'status';
}
function updateButtons() {
  const has = hasUnsavedDraft();
  $('#rec').disabled = busy;
  $('#save').disabled = busy || !has;
  $('#discard').disabled = busy || !has;
}
function resetDraft() {
  draftTranscripts = [];
  draftCost = 0;
  $('#draft').value = '';
  showOriginal();
  updateButtons();
}
function showOriginal() {
  $('#original').hidden = !draftTranscripts.length;
  $('#original').open = false;
  $('#original-text').textContent = draftTranscripts.join('\n\n');
}

let selecting = 0;  // the latest selectPupil call; earlier ones that finish later are dropped

async function selectPupil(p) {
  if (!apiKey || current?.id === p.id || !(await okToLeaveDraft())) return;
  // Everything the page needs is read before it's drawn, so it appears complete in one go.
  const call = ++selecting;
  const [notes, classes] = await Promise.all([store.listNotes(p.id), store.listTree()]);
  if (call !== selecting) return;
  current = p;
  view = null;
  saveRoute();
  draftTranscripts = [];
  draftCost = 0;
  markActive();
  const main = $('#main');
  main.replaceChildren($('#pupil-view').content.cloneNode(true));
  showRoster(p, classes);
  $('h2', main).textContent = p.name;
  $('#pupil-class').textContent = p.className ?? 'Class';
  $('#pupil-year').textContent = store.selectedYear();
  const editable = store.isCurrentYear();
  $('#past-year').hidden = editable;
  $('#recorder').hidden = !editable;
  drawWave([]);
  $('#delete-pupil').hidden = !editable;
  // Previous/next pupil within the class, in the sidebar's (alphabetical) order.
  // The list is re-read on each click so it's fresh after edits elsewhere.
  const gotoPupil = async dir => {
    const klass = (await store.listTree()).find(c => c.id === p.class_id);
    const pupils = klass?.pupils ?? [];
    const i = pupils.findIndex(x => x.id === p.id);
    const target = pupils[i + dir];
    if (target) selectPupil({ ...target, className: klass.name });
  };
  $('#prev-pupil').onclick = () => gotoPupil(-1);
  $('#next-pupil').onclick = () => gotoPupil(1);
  const siblings = classes.find(c => c.id === p.class_id)?.pupils ?? [];
  const at = siblings.findIndex(x => x.id === p.id);
  $('#prev-pupil').disabled = at <= 0;
  $('#next-pupil').disabled = at < 0 || at >= siblings.length - 1;
  $('#rec').onclick = toggleRecording;
  $('#save').onclick = saveNote;
  $('#discard').onclick = resetDraft;
  $('#use-original').onclick = () => { $('#draft').value = draftTranscripts.join('\n\n'); updateButtons(); };
  $('#draft').oninput = updateButtons;
  $('#export-pupil').onclick = async () => {
    try {
      const path = await store.exportPupil(p);
      editable ? setStatus(`Saved ${path}`) : notice('Notes exported', `Saved ${path} in your ${store.folderName()} folder.`);
    } catch (err) { notice('Export failed', err.message); }
  };
  $('#delete-pupil').onclick = async () => {
    if (recording()) { setStatus('Stop the recording before deleting.', true); return; }
    if (!(await okToLeaveDraft())) return;
    if (!(await confirmModal({
      title: `Delete ${p.name}?`,
      text: `This deletes ${p.name} and all their notes for ${store.selectedYear()}. This can't be undone.`,
      confirmLabel: 'Delete pupil', danger: true,
    }))) return;
    await store.deletePupil(p.id);
    current = null;
    await openClass(p.class_id);
    refreshSidebar();
  };
  renderNotes(notes);
}

const formatDate = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

// notes: already loaded, to draw without waiting; otherwise they're read again.
async function renderNotes(notes = null) {
  const pupilId = current.id;
  notes ??= await store.listNotes(pupilId);
  if (current?.id !== pupilId) return;
  const box = $('#notes');
  box.replaceChildren();
  $('#note-count').textContent = notes.length || '';
  if (!notes.length) box.append(el('p', { className: 'empty', textContent: 'No notes yet.' }));
  for (const n of notes) box.append(noteElement(n));
}

// Fades an element out and closes the gap it leaves, then removes it.
async function fadeOut(element) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const height = `${element.offsetHeight}px`;
    element.style.overflow = 'hidden';
    await element.animate([
      { opacity: 1, transform: 'scale(1)', height, offset: 0 },
      { opacity: 0, transform: 'scale(.98)', height, offset: .6 },
      { opacity: 0, transform: 'scale(.98)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-10px' },
    ], { duration: 450, easing: 'ease-in-out', fill: 'forwards' }).finished;
  }
  element.remove();
}

function noteElement(n) {
  const edit = el('button', { className: 'btn small', textContent: 'Edit' });
  const del = el('button', { className: 'btn small', textContent: 'Delete' });
  const meta = [];
  if (n.updated_at) meta.push(`edited ${formatDate(n.updated_at)}`);
  if (n.cost_usd != null) meta.push(`est. ${mistral.formatCost(n.cost_usd)}`);
  const text = el('p', { className: 'note-text', textContent: n.text });
  const body = el('div', { className: 'note-body' },
    el('div', { className: 'note-top' },
      el('div', {}, el('strong', { textContent: formatDate(n.created_at) }), el('span', { className: 'meta', textContent: meta.join(' · ') })),
      el('div', { className: 'actions' }, edit, del)),
    text);
  if (n.transcript && n.transcript !== n.text) {
    body.append(el('details', {}, el('summary', { textContent: 'Original transcript' }), el('p', { textContent: n.transcript })));
  }
  const div = el('article', { className: 'note' }, el('span', { className: 'tile' }, el('span', { className: 'ico i-note' })), body);

  del.onclick = async () => {
    if (!(await confirmModal({
      title: 'Delete this note?',
      text: n.text.length > 160 ? `${n.text.slice(0, 160)}…` : n.text,
      confirmLabel: 'Delete note', danger: true,
    }))) return;
    try {
      await store.deleteNote(n.id);
      await fadeOut(div);
      renderNotes();
      refreshSpend();
    } catch (err) { notice('Could not delete the note', err.message); }
  };

  edit.onclick = () => {
    const area = el('textarea', { value: n.text });
    const save = el('button', { className: 'btn primary small', textContent: 'Save' });
    const cancel = el('button', { className: 'btn small', textContent: 'Cancel' });
    const controls = el('div', { className: 'row' }, save, cancel);
    edit.disabled = true;
    text.replaceWith(area);
    area.after(controls);
    area.focus();
    cancel.onclick = () => renderNotes();
    save.onclick = async () => {
      save.disabled = true;
      try {
        await store.updateNote(n.id, area.value);
        renderNotes();
      } catch (err) {
        notice('Could not save the note', err.message);
        save.disabled = false;
      }
    };
  };
  return div;
}

// Shown on the settings screen only.
async function refreshSpend() {
  const year = store.selectedYear();
  const text = !apiKey ? 'Not connected.'
    : year ? `Connected. Estimated cost for ${year}: ${mistral.formatCost(await store.yearCost())}.` : 'Connected.';
  if ($('#s-spend')) $('#s-spend').textContent = text;
}

// --- Live waveform in the record bar ---
let wave = null;  // { audio, raf, timer } while recording

function drawWave(levels) {
  const canvas = $('#wave');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const step = 5, bars = Math.floor(w / step);
  for (let i = 0; i < bars; i++) {
    const level = levels[levels.length - bars + i] ?? 0;
    const bar = Math.max(2, Math.min(h, level * h * 2.5));
    g.fillStyle = level > 0.03 ? '#8be3ef' : 'rgba(255, 255, 255, .28)';
    g.fillRect(i * step, (h - bar) / 2, 2, bar);
  }
}

window.addEventListener('resize', () => { if (!wave) drawWave([]); });

function startWave(stream) {
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  audio.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const levels = [];
  let last = 0;
  const frame = now => {
    if (now - last > 45) {
      last = now;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      levels.push(peak / 128);
      if (levels.length > 400) levels.shift();
      drawWave(levels);
    }
    wave.raf = requestAnimationFrame(frame);
  };
  const clock = () => {
    const secs = Math.floor((performance.now() - recordingStarted) / 1000);
    $('#timer').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  clock();
  setStatus('Recording… press Stop when you have finished.');
  wave = { audio, raf: requestAnimationFrame(frame), timer: setInterval(clock, 500) };
}

function stopWave() {
  if (!wave) return;
  cancelAnimationFrame(wave.raf);
  clearInterval(wave.timer);
  wave.audio.close();
  wave = null;
  drawWave([]);
}

function showRecording(on) {
  if (!$('#rec')) return;
  $('#rec').classList.toggle('recording', on);
  $('#rec-label').textContent = on ? 'Stop' : 'Record';
  $('#timer').classList.toggle('live', on);
}

// --- Record → transcribe → tidy ---
let recordingStarted = 0;

async function toggleRecording() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setStatus(`Microphone unavailable: ${e.message}`, true);
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    stopWave();
    showRecording(false);
    processRecording(new Blob(chunks, { type: recorder.mimeType }), (performance.now() - recordingStarted) / 1000);
  };
  recorder.start();
  recordingStarted = performance.now();
  showRecording(true);
  startWave(stream);
}

async function processRecording(blob, seconds) {
  // The pupil, class and draft this recording belongs to. If the view changes
  // underneath us, the result is discarded instead of landing on someone else.
  const pupilId = current?.id;
  const classId = current?.class_id;
  const draft = $('#draft');
  const viewChanged = () => current?.id !== pupilId || $('#draft') !== draft;
  busy = true;
  updateButtons();
  const started = performance.now();
  let transcript = null;
  try {
    setStatus('Transcribing…');
    const names = (await store.listPupils(classId)).map(p => p.name);
    transcript = await mistral.transcribe(apiKey, blob, names, seconds);
    if (!transcript.text) {
      setStatus('No speech detected. Try again.', true);
      return;
    }
    if (viewChanged()) {
      notice('Recording discarded', 'The pupil was changed while it was being transcribed.');
      return;
    }
    setStatus('Tidying…');
    const polished = await mistral.polish(apiKey, transcript.text);
    const cost = transcript.cost + polished.cost;
    draftTranscripts.push(transcript.text);
    draftCost += cost;
    const existing = draft.value.trim();
    draft.value = existing ? `${existing}\n\n${polished.text}` : polished.text;
    showOriginal();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const costText = `est. cost ${mistral.formatCost(cost)} (transcription ${mistral.formatCost(transcript.cost)}, tidy ${mistral.formatCost(polished.cost)})`;
    if (polished.rejected) {
      setStatus(`Couldn't tidy this one reliably, so the transcript is shown as recorded · ${costText}`);
    } else if (polished.skipped) {
      setStatus(`Too short to tidy, so the transcript is shown as recorded · ${costText}`);
    } else {
      setStatus(`Done in ${secs}s · ${costText}`);
    }
  } catch (e) {
    if (transcript?.text && !viewChanged()) {
      // Keep the transcript if only the tidy step failed.
      draftTranscripts.push(transcript.text);
      draftCost += transcript.cost;
      const existing = draft.value.trim();
      draft.value = existing ? `${existing}\n\n${transcript.text}` : transcript.text;
      showOriginal();
    }
    if (e instanceof mistral.ApiKeyError) {
      forgetKey();
      apiKey = null;
      await notice(e.message, 'Please enter your Mistral API key again.');
      showKeyForm();
      return;
    }
    setStatus(e.message, true);
  } finally {
    busy = false;
    if ($('#rec')) updateButtons();
  }
}

async function saveNote() {
  try {
    await store.addNote(current.id, $('#draft').value, {
      transcript: draftTranscripts.join('\n\n') || null,
      cost_usd: draftTranscripts.length ? draftCost : null,
    });
  } catch (err) {
    setStatus(`Could not save: ${err.message}`, true);
    return;
  }
  resetDraft();
  setStatus('Saved.');
  renderNotes();
  refreshSpend();
}

async function exportAll() {
  if (!store.selectedYear()) return;
  try {
    notice('Export saved', `Saved ${await store.exportAllCsv()} in your ${store.folderName()} folder.`);
  } catch (err) { notice('Export failed', err.message); }
}

// --- Start ---
if (!store.supported()) {
  $('#main').replaceChildren($('#unsupported-view').content.cloneNode(true));
} else {
  const state = await store.restoreFolder().catch(() => 'not-chosen');
  if (state === 'connected') folderReady();
  else showFolderForm(state === 'needs-permission');
}
