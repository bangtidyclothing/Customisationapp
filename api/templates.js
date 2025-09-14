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
  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured', details: 'Missing Airtable env vars' });
  }

  // query flags
  const wantSlug = 'slug' in req.query;         // ?slug=1 -> include { slug: { type } }
  const typeStyle = (req.query.type || '').toString(); // ?type=kebab|raw

  try {
    const records = await fetchAllAirtable({
      baseId: AIRTABLE_BASE_ID,
      apiKey: AIRTABLE_API_KEY,
      table: TABLE,
      view: process.env.AIRTABLE_VIEW || undefined,
    });

    const mapped = records.map((r) => mapRecord(r, { wantSlug, typeStyle }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ records: mapped });
  } catch (err) {
    console.error('Airtable error', err);
    const details = (err && err.message) || String(err);
    return res.status(500).json({ error: 'Airtable error', details });
  }
}

/* ---------------- helpers ---------------- */

async function fetchAllAirtable({ baseId, apiKey, table, view }) {
  const out = [];
  let url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`);
  if (view) url.searchParams.set('view', view);
  // IMPORTANT: do NOT set fields[] — unknown columns would 400
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

function mapRecord(rec, { wantSlug, typeStyle }) {
  const f = rec.fields || {};

  const template_id = clean(firstNonEmpty(
    f.template_id, f.Template_id, f['Template ID'], f['template id']
  ));
  const name = clean(firstNonEmpty(f.name, f.Name, f.Title));

  // Human “TYPE” (pretty label)
  const TYPE = clean(firstNonEmpty(f.TYPE, f.Type, f['TYPE Label']));

  // Machine type (kebab preferred). If not present, derive from TYPE.
  const typeRaw = clean(firstNonEmpty(f.type, f.Type_machine, f['Type (machine)']));
  const type = (typeStyle === 'raw')
    ? (typeRaw || TYPE || '')
    : toKebab(typeRaw || TYPE || '');

  // JSON blobs (any of these column names will work)
  const fields_json = firstNonEmpty(f.fields_json, f.Fields_json, f.fields, f.Fields);
  const layout_spec = firstNonEmpty(f.layout_spec, f.Layout_spec, f.layout, f.Layout);
  const type_meta   = firstNonEmpty(f.type_meta, f.TYPE_META, f.Type_meta, f.TypeMeta);

  const fields = toArrayJSON(fields_json);
  const layout = toObjectJSON(layout_spec);
  const typeMeta = toObjectJSON(type_meta) || {};

  // Optional booleans — tolerate missing/renamed
  const requires_photo = toBool(firstNonEmpty(f.requires_photo, f.Requires_photo, f['Requires photo']));
  const requires_text  = toBool(firstNonEmpty(f.requires_text,  f.Requires_text,  f['Requires text']));
  const optional       = toBool(firstNonEmpty(f.optional,       f.Optional));
  const optional_photo = toBool(firstNonEmpty(f.optional_photo, f.Optional_photo, f['Optional photo']));
  const optional_text  = toBool(firstNonEmpty(f.optional_text,  f.Optional_text,  f['Optional text']));

  // Base image: allow URL string or attachment array
  let base_image = firstNonEmpty(f.base_image, f.Base_image, f['Base Image']);
  // leave as-is; frontend normaliser already handles attachment arrays

  const out = {
    template_id,
    name,
    TYPE,
    fields,
    layout,
    requires_photo,
    requires_text,
    optional,
    optional_photo,
    optional_text,
    base_image,
    type,
    typeMeta,
  };
  if (wantSlug) out.slug = { type };
  return out;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return undefined;
}
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function toKebab(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function toBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', ''].includes(s)) return false;
  return false;
}
function toObjectJSON(v) {
  try {
    if (!v) return null;
    if (typeof v === 'string') return JSON.parse(v);
    if (typeof v === 'object') return v;
    return null;
  } catch { return null; }
}
function toArrayJSON(v) {
  const o = toObjectJSON(v);
  return Array.isArray(o) ? o : [];
}
