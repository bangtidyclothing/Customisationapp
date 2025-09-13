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
  const BASE_ID   = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE;
  const TABLE     = process.env.AIRTABLE_TABLE || 'templates';
  const API_ROOT  = process.env.AIRTABLE_API || 'https://api.airtable.com/v0';
  if (!API_KEY || !BASE_ID) return res.status(500).json({ error: 'Airtable env not configured' });

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
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fallback; }
  };

  const safeArray = (v) => {
    if (Array.isArray(v)) return v;
    const p = safeParse(v, []);
    return Array.isArray(p) ? p : [];
  };

  const safeFields = (v) => {
    const arr = safeArray(v);
    return arr.filter(x => x && typeof x === 'object' && (x.key || x.id || x.name));
  };

  const safeLayout = (v) => {
    const o = safeParse(v, null);
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.elements)) return o;
    if (o.layout && Array.isArray(o.layout.elements)) return o.layout;
    return o;
  };

  // --- Fields to fetch (NOTE the capital L in Layout_spec) ---
  const FIELDS = [
    'template_id', 'name', 'TYPE',
    'fields_json', 'Layout_spec',
    'requires_photo', 'requires_text',
    'optional', 'optional_photo', 'optional_text',
    'base_image',
    'type_title', 'type_instructions_md', 'type_requirements_json'
  ];

  // --- Build Airtable URL ---
  const search = [];
  search.push('pageSize=100');
  search.push('view=' + encodeURIComponent('Grid view'));
  for (const f of FIELDS) search.push('fields[]=' + encodeURIComponent(f));

  if (filterTemplate) {
    const quoted = filterTemplate.replace(/'/g, "\\'");
    const formula = `({template_id} = '${quoted}')`;
    search.push('filterByFormula=' + encodeURIComponent(formula));
  }

  const url = `${API_ROOT}/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(TABLE)}?${search.join('&')}`;

  // --- Fetch Airtable ---
  let data;
  try {
    const atRes = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
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

    const originalType = f.TYPE || '';
    const kebabType = toKebab(originalType);

    return {
      template_id: f.template_id || '',
      name: f.name || '',
      TYPE: originalType,
      fields: safeFields(f.fields_json),          // expects JSON array in fields_json
      layout: safeLayout(f.Layout_spec),          // NOTE: capital L
      requires_photo: !!(f.requires_photo === true || f.requires_photo === 'true' || f.requires_photo === 1),
      requires_text:  !!(f.requires_text  === true || f.requires_text  === 'true' || f.requires_text  === 1),
      optional:        !!(f.optional === true || f.optional === 'true' || f.optional === 1),
      optional_photo:  !!(f.optional_photo === true || f.optional_photo === 'true' || f.optional_photo === 1),
      optional_text:   !!(f.optional_text  === true || f.optional_text  === 'true' || f.optional_text  === 1),
      base_image: f.base_image || null,
      typeMeta: {
        title: f.type_title || null,
        instructions_md: f.type_instructions_md || '',
        requirements: safeArray(f.type_requirements_json)
      },
      ...(wantKebabType ? { type: kebabType } : {}),
      ...(wantSlugObj   ? { slug: { type: kebabType } } : {})
    };
  });

  return res.status(200).json({ records });
}
