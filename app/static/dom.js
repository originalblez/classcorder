// Small DOM helpers shared by the app's screens.

export const $ = (sel, root = document) => root.querySelector(sel);

export const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Fills the shared <dialog> from a template and opens it. Buttons marked data-close close it.
export function openModal(templateId) {
  const modal = $('#modal');
  modal.replaceChildren($(`#${templateId}`).content.cloneNode(true));
  for (const b of modal.querySelectorAll('[data-close]')) b.onclick = () => modal.close();
  modal.showModal();
  return modal;
}

// Frosted replacements for the browser's confirm() and alert(). They use their own <dialog>,
// so they can open on top of another modal. Resolves true if confirmed.
export function confirmModal({ title, text = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const dialog = $('#confirm');
  dialog.replaceChildren($('#confirm-modal').content.cloneNode(true));
  $('h2', dialog).textContent = title;
  $('#c-text', dialog).textContent = text;
  $('#c-text', dialog).hidden = !text;
  const ok = $('#c-ok', dialog);
  const cancel = $('#c-cancel', dialog);
  ok.textContent = confirmLabel;
  ok.classList.toggle('destructive', danger);
  cancel.textContent = cancelLabel ?? '';
  cancel.hidden = cancelLabel == null;
  cancel.onclick = () => dialog.close('cancel');
  $('form', dialog).onsubmit = e => { e.preventDefault(); dialog.close('ok'); };
  dialog.returnValue = '';
  dialog.showModal();
  // For destructive actions, Enter shouldn't delete anything by accident.
  (danger ? cancel : ok).focus();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

export const notice = (title, text = '') => confirmModal({ title, text, cancelLabel: null });
