// api/templates.js
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  const { AIRTABLE_BASE_ID, AIRTABLE_API_KEY } = process.env;
  const TABLE = process.env.AIRTABLE_TABLE || 'templates';
  const VIEW  = process.env.AIRTABLE_VIEW || undefined;

  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured', details: 'Missing Airtable env vars' });
  }

  const wantSlug  = 'slug' in req.query;               // ?slug=1
  const typeStyle = (req.query.type || 'kebab');        // kebab | raw

  try {
    const records = await fetchAllAirtable({ baseId: AIRTABLE_BASE_ID, apiKey: AIRTABLE_API_KEY, table: TABLE, view: VIEW });
    const mapped  = records.map(r => mapRecordExact(r, { wantSlug, typeStyle }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ records: mapped });
  } catch (err) {
    console.error('Airtable error', err);
    return res.status(500).json({ error: 'Airtable error', details: err?.message || String(err) });
  }
}

/* ---------------- helpers ---------------- */

async function fetchAllAirtable({ baseId, apiKey, table, view }) {
  const out = [];
  let url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`);
  if (view) url.searchParams.set('view', view);

  while (true) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    out.push(...(data.records || []));
    if (!data.offset) break;
    url.searchParams.set('offset', data.offset);
  }
  return out;
}

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const toKebab = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function pickExact(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}
function tryJSON(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}
function toArray(v) {
  if (Array.isArray(v)) return v;
  const parsed = tryJSON(v);
  return Array.isArray(parsed) ? parsed : [];
}
function toObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  const parsed = tryJSON(v);
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
}
function toBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['1','true','yes','y'].includes(s)) return true;
  if (['0','false','no','n',''].includes(s)) return false;
  return false;
}

function mapRecordExact(rec, { wantSlug, typeStyle }) {
  const f = rec.fields || {};

  // Exact-capitalised column names first, then lower/alt fallbacks as backup.
  const template_id = clean(pickExact(f, ['Template_id', 'template_id', 'Template ID', 'template id']) ?? rec.id);
  const name        = clean(pickExact(f, ['Name', 'name', 'Title', 'title']) ?? '');
  const TYPELabel   = clean(pickExact(f, ['TYPE', 'Type']) ?? '');

  // Machine type: prefer explicit "Type" (machine); else derive from TYPE label.
  const typeMachineRaw = clean(pickExact(f, ['Type', 'type', 'Type (machine)']) ?? '');
  const typeOut = (typeStyle === 'raw')
    ? (typeMachineRaw || TYPELabel || '')
    : toKebab(typeMachineRaw || TYPELabel || '');

  // JSON blobs
  const fields_json = pickExact(f, ['Fields_json', 'fields_json', 'Fields']);
  const layout_spec = pickExact(f, ['Layout_spec', 'layout_spec', 'Layout']);
  const type_meta   = pickExact(f, ['Type_meta', 'TYPE_META', 'type_meta']);

  // Optional flags (exact first)
  const requires_photo = toBool(pickExact(f, ['Requires_photo', 'requires_photo']));
  const requires_text  = toBool(pickExact(f, ['Requires_text',  'requires_text']));
  const optional       = toBool(pickExact(f, ['Optional',       'optional']));
  const optional_photo = toBool(pickExact(f, ['Optional_photo', 'optional_photo']));
  const optional_text  = toBool(pickExact(f, ['Optional_text',  'optional_text']));

  // Base image (string URL or attachments array)
  let base_image = pickExact(f, ['Base_image', 'base_image']);
  if (Array.isArray(base_image) && base_image[0]?.url) base_image = base_image[0].url;

  // Parse JSON fields
  const fields = toArray(fields_json);
  const layout = toObject(layout_spec);

  // typeMeta: accept JSON object or string; empty -> {}
  let typeMeta = toObject(type_meta);
  if (!typeMeta && typeof type_meta === 'string') {
    // allow plain text in Type_meta as instructions
    typeMeta = { instructions_md: String(type_meta) };
  }
  if (!typeMeta) typeMeta = {};

  const out = {
    template_id,
    name,
    TYPE: TYPELabel,
    fields,
    layout,
    requires_photo,
    requires_text,
    optional,
    optional_photo,
    optional_text,
    base_image: base_image ?? null,
    type: typeOut,
    typeMeta,
  };
  if (wantSlug) out.slug = { type: typeOut };
  return out;
}
