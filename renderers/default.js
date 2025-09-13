// /renderers/default.js
// Minimal TYPE renderer: wires file uploads -> preview via object URLs,
// adds Remove action, blocks Enter. Safe with your current flow.

const state = { blobs: {} }; // { key: { url } }

function getVisibleImageFields(ctx) {
  return (ctx.template?.fields || []).filter(f => f.type === 'image' && !f.hidden);
}

function inputsFromForm(ctx) {
  const out = {};
  for (const f of (ctx.template?.fields || [])) {
    if (f.type === 'text') {
      const el = document.getElementById(`f_${f.key}`);
      out[f.key] = (el?.value || '').trim();
    } else if (f.type === 'image') {
      const urlEl = document.getElementById(`f_${f.key}_url`);
      out[f.key] = (urlEl?.value || '').trim();
    }
  }
  return out;
}

function revoke(key) {
  const prev = state.blobs[key]?.url;
  if (prev) { try { URL.revokeObjectURL(prev); } catch (_) {} }
  delete state.blobs[key];
}

function clearPhotoField(key, ctx) {
  revoke(key);
  const urlEl = document.getElementById(`f_${key}_url`);
  const fileEl = document.getElementById(`f_${key}_file`);
  if (urlEl) urlEl.value = '';
  if (fileEl) fileEl.value = '';
  const inputs = inputsFromForm(ctx);
  ctx.utils.renderPreview(ctx.template, { ...inputs, template_id: ctx.template.template_id });
}

function handlePhotoUpload(ev, key, ctx) {
  const fileEl = ev.currentTarget;
  const file = fileEl?.files?.[0];
  if (!file || !file.type?.startsWith('image/')) { clearPhotoField(key, ctx); return; }
  revoke(key);
  const url = URL.createObjectURL(file);
  state.blobs[key] = { url };
  const urlEl = document.getElementById(`f_${key}_url`);
  if (urlEl) urlEl.value = url;
  const inputs = inputsFromForm(ctx);
  ctx.utils.renderPreview(ctx.template, { ...inputs, template_id: ctx.template.template_id });
}

function blockEnter() {
  document.addEventListener('keydown', (e) => {
    const t = e.target?.tagName;
    if (e.key === 'Enter' && (t === 'INPUT' || t === 'TEXTAREA')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

export function init(ctx) {
  for (const f of getVisibleImageFields(ctx)) {
    const fileEl = document.getElementById(`f_${f.key}_file`);
    const rmBtn  = document.getElementById(`f_${f.key}_remove`);
    if (fileEl && !fileEl.__wired) {
      fileEl.addEventListener('change', (e) => handlePhotoUpload(e, f.key, ctx));
      fileEl.__wired = true;
    }
    if (rmBtn && !rmBtn.__wired) {
      rmBtn.addEventListener('click', () => clearPhotoField(f.key, ctx));
      rmBtn.__wired = true;
    }
  }
  blockEnter();

  // optional debug
  window.clearPhotoField = (k)=>clearPhotoField(k,ctx);
  window.handlePhotoUpload = (e,k)=>handlePhotoUpload(e,k,ctx);
  window.fitImageInBox = (mode='cover') => mode==='contain' ? 'xMidYMid meet' : 'xMidYMid slice';

  window.addEventListener('beforeunload', () => {
    for (const k of Object.keys(state.blobs)) revoke(k);
  });
}

export default { init };
