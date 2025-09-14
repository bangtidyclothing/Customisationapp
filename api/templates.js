// api/templates.js — stable, casing-tolerant, no extras
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

  const wantSlug  = 'slug' in req.query;                 // ?slug=1 -> include { slug: { type } }
  const typeStyle = (req.query.type || 'kebab').toString(); // kebab | raw

  try {
    const records = await fetchAllAirtable({ baseId: AIRTABLE_BASE_ID, apiKey: AIRTABLE_API_KEY, table: TABLE, view: VIEW });
    const mapped  = records.map(r => mapRecord(r, { wantSlug, typeStyle }));
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

  // Important: do NOT request a fixed fields[] list (avoids UNKNOWN_FIELD_NAME).
  while (true) {
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    out.push(...(data.records || []));
    if (!data.offset) break;
    url.searchParams.set('offset', data.offset);
  }
  return out;
}

const clean   = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const toKebab = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function normKey(k){ return String(k||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function pickField(obj, candidates){
  if (!obj) return undefined;
  // exact first
  for (const c of candidates) if (c in obj) return obj[c];
  // fuzzy by normalized key
  const map = new Map(Object.keys(obj).map(k => [normKey(k), k]));
  for (const c of candidates) {
    const nk = normKey(c);
    if (map.has(nk)) return obj[map.get(nk)];
  }
  return undefined;
}
function tryJSON(v){
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}
function toArray(v){ if (Array.isArray(v)) return v; const p = tryJSON(v); return Array.isArray(p) ? p : []; }
function toObject(v){ if (v && typeof v === 'object' && !Array.isArray(v)) return v; const p = tryJSON(v); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null; }
function toBool(v){
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['1','true','yes','y'].includes(s)) return true;
  if (['0','false','no','n',''].includes(s)) return false;
  return false;
}

function mapRecord(rec, { wantSlug, typeStyle }) {
  const f = rec.fields || {};

  const template_id = clean(pickField(f, ['Template_id','template_id','Template ID','template id']) ?? rec.id);
  const name        = clean(pickField(f, ['Name','name','Title','title']) ?? '');

  // Human label (pretty)
  const TYPELabel   = clean(pickField(f, ['TYPE','Type']) ?? '');

  // Machine type (explicit preferred; else derived from TYPE label)
  const typeRaw     = clean(pickField(f, ['Type','type','Type (machine)']) ?? '');
  const typeOut     = (typeStyle === 'raw') ? (typeRaw || TYPELabel || '') : toKebab(typeRaw || TYPELabel || '');

  // JSON blobs (accept capitalised or lowercase column names)
  const fields_json = pickField(f, ['Fields_json','fields_json','Fields']);
  const layout_spec = pickField(f, ['Layout_spec','layout_spec','Layout']);

  const fields = toArray(fields_json);
  const layout = toObject(layout_spec);

  // Optional flags (tolerant)
  const requires_photo = toBool(pickField(f, ['Requires_photo','requires_photo']));
  const requires_text  = toBool(pickField(f, ['Requires_text','requires_text']));
  const optional       = toBool(pickField(f, ['Optional','optional']));
  const optional_photo = toBool(pickField(f, ['Optional_photo','optional_photo']));
  const optional_text  = toBool(pickField(f, ['Optional_text','optional_text']));

  // Base image: URL string or first attachment
  let base_image = pickField(f, ['Base_image','base_image']);
  if (Array.isArray(base_image) && base_image[0]?.url) base_image = base_image[0].url;

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
  };
  if (wantSlug) out.slug = { type: typeOut };
  return out;
}
