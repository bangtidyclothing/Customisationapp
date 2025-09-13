// /api/templates.js
export default async function handler(req, res) {
  // --- CORS / method guard ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  // --- Env ---
  const API_KEY   = process.env.AIRTABLE_API_KEY;
  const BASE_ID   = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE;   // support either name
  const TABLE     = process.env.AIRTABLE_TABLE || 'templates';
  const API_ROOT  = process.env.AIRTABLE_API || 'https://api.airtable.com/v0';

  if (!API_KEY || !BASE_ID) {
    return res.status(500).json({ error: 'Airtable env not configured' });
  }

  // --- Query params ---
  const qp = req.query || {};
  const wantSlugObj    = String(qp.slug || '') === '1';
  const wantKebabType  = String(qp.type || '') === 'kebab';
  const filterTemplate = (qp.template_id || '').toString().trim();

  // --- Helpers ---
  const toKebab = (s) =>
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const safeParse = (v, fallback = null) => {
    if (v == null) return fallback;
    if (typeof v === 'object') return v; // already parsed
    try { return JSON.parse(v); } catch { return fallback; }
  };

  const safeArray = (v) => {
    if (Array.isArray(v)) return v;
    const p = safeParse(v, []);
    return Array.isArray(p) ? p : [];
  };

  const safeFields = (v) => {
    const arr = safeArray(v);
    // minimal validation: ensure each item has a key/type
    return arr.filter(x => x && typeof x === 'object' && (x.key || x.id || x.name));
  };

  const safeLayout = (v) => {
    const o = safeParse(v, null);
    if (!o || typeof o !== 'object') return null;
    // normalise a couple of common shapes
    if (Array.isArray(o.elements)) {
      return o;
    }
    // sometimes layout comes as { layout: { elements: [...] } }
    if (o.layout && Array.isArray(o.layout.elements)) {
      return o.layout;
    }
    return o;
  };

  // --- Fields to fetch from Airtable ---
  const FIELDS = [
    'template_id', 'name', 'TYPE',
    'fields_json', 'layout_spec',
    'requires_photo', 'requires_text',
    'optional', 'optional_photo', 'optional_text',
    'base_image',
    // NEW:
    'type_title', 'type_instructions_md', 'type_requirements_json'
  ];

  // --- Build Airtable URL ---
  const search = [];
  search.push('pageSize=100');
  search.push('view=' + encodeURIComponent('Grid view'));
  for (const f of FIELDS) search.push('fields[]=' + encodeURIComponent(f));

  if (filterTemplate) {
    // filterByFormula: {template_id} = '...'
    const quoted = filterTemplate.replace(/'/g, "\\'");
    const formula = `({template_id} = '${quoted}')`;
    search.push('filterByFormula=' + encodeURIComponent(formula));
  }

  const url = `${API_ROOT}/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(TABLE)}?${search.join('&')}`;

  // --- Fetch Airtable ---
  let data;
  try {
    const atRes = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    if (!atRes.ok) {
      const txt = await atRes.text().catch(() => '');
      return res.status(atRes.status).json({ error: 'Airtable error', details: txt });
    }
    data = await atRes.json();
  } catch (e) {
    return res.status(502).json({ error: 'Upstream fetch failed', details: String(e && e.message || e) });
  }

  const atRecords = Array.isArray(data.records) ? data.records : [];

  // --- Map records to frontend shape ---
  const records = atRecords.map(r => {
    const f = r.fields || {};
    const fields = safeFields(f.fields_json);
    const layout = safeLayout(f.layout_spec);

    const meta = {
      title: f.type_title || null,
      instructions_md: f.type_instructions_md || '',
      requirements: safeArray(f.type_requirements_json)
    };

    const originalType = f.TYPE || '';
    const kebabType = toKebab(originalType);

    const out = {
      template_id: f.template_id || '',
      name: f.name || '',
      TYPE: originalType,                 // keep original (as requested)
      fields,
      layout,
      requires_photo: !!f.requires_photo || f.requires_photo === true,
      requires_text:  !!f.requires_text  || f.requires_text  === true,
      optional:        !!f.optional,
      optional_photo:  !!f.optional_photo,
      optional_text:   !!f.optional_text,
      base_image: f.base_image || null,
      typeMeta: meta
    };

    // Optional helpers based on query flags
    if (wantKebabType) out.type = kebabType;      // e.g. "beer-mat-photo"
    if (wantSlugObj)  out.slug = { type: kebabType };

    return out;
  });

  return res.status(200).json({ records });
}
