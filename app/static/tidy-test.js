// A small development tool for testing the tidy prompt without recording anything.
// It uses the same mistral.js and key.js as the app, so it tests exactly what ships.
import * as mistral from './mistral.js';
import { loadKey, saveKey } from './key.js';

const $ = sel => document.querySelector(sel);

let apiKey = await loadKey();
if (!apiKey) $('#key-card').hidden = false;

$('#key-save').onclick = async () => {
  const value = $('#key-input').value.trim();
  const status = $('#key-status');
  if (!value) return;
  status.className = 'status';
  status.textContent = 'Checking…';
  try {
    await mistral.checkKey(value);
    await saveKey(value);
    apiKey = value;
    $('#key-card').hidden = true;
    status.textContent = '';
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
  }
};

$('#run').onclick = async () => {
  const transcript = $('#in').value.trim();
  const run = $('#run'), status = $('#status'), meta = $('#meta');
  if (!transcript || !apiKey) return;
  run.disabled = true;
  status.className = 'status';
  status.textContent = 'Tidying…';
  $('#out').value = '';
  meta.textContent = '';
  try {
    const result = await mistral.polish(apiKey, transcript);
    $('#out').value = result.text;
    const bits = [`est. cost ${mistral.formatCost(result.cost)}`];
    if (result.skipped) bits.push('too short to tidy, so the transcript is returned as it is');
    else if (result.rejected) bits.push(`rejected: most of the tidied text was new, so the transcript is kept (added: ${result.added.join(', ')})`);
    else bits.push(`added words: ${result.added.join(', ') || 'none'}`);
    meta.textContent = bits.join(' · ');
    status.textContent = 'Done.';
  } catch (err) {
    status.className = 'status error';
    if (err instanceof mistral.ApiKeyError) {
      apiKey = null;
      $('#key-card').hidden = false;
      $('#key-status').textContent = err.message;
    }
    status.textContent = err.message;
  } finally {
    run.disabled = false;
  }
};
