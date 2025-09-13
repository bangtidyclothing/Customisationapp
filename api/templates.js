// /api/templates.js
// Minimal, stable proxy that returns { records: [...] } for the UI you pasted.
// Uses Airtable if env vars exist; otherwise returns a demo record so the list renders.

const AIRTABLE_API = 'https://api.airtable.com/v0';

function kebab(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  res.setHeader('Cache-Control', 'no-store');

  const { AIRTABLE_BASE, AIRTABLE_API_KEY, AIRTABLE_TABLE = 'templates' } = process.env;
  const { type = 'kebab' } = req.query;

  // No Airtable configured? Return a safe demo so the list doesn’t look broken.
  if (!AIRTABLE_BASE || !AIRTABLE_API_KEY) {
    return res.status(200).json({
      records: [
        {
          template_id: 'tpl-demo-1',
          name: 'Demo Template',
          fields: [],
          layout: { canvasMM: [100, 100], elements: [] },
          requires_photo: true,
          requires_text: true,
          optional: false,
          optional_photo: false,
          optional_text: false,
        },
      ],
    });
  }

  try {
    const url = `${AIRTABLE_API}/${encodeURIComponent(AIRTABLE_BASE)}/${encodeURIComponent(AIRTABLE_TABLE)}?view=Grid%20view`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: `Airtable ${r.status}`, details: txt });
    }
    const data = await r.json();

    // Map Airtable rows -> the shape your UI expects
    const records = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      const name = f.name || f.Name || '';
      const fromType = f.TYPE || f.Type || f.type || '';
      const idFromField = f.template_id || f.slug || '';

      const computedId =
        idFromField ||
        (type === 'kebab'
          ? `tpl-${kebab(name || rec.id)}`
          : name || rec.id);

      return {
        template_id: computedId,
        name,
        TYPE: fromType,                 // carried through, used later if you route by TYPE
        fields: parseJSON(f.fields_json, []),
        layout: parseJSON(f.layout_spec, { canvasMM: [100, 100], elements: [] }),
        // table-level flags (defaulting to current UI assumptions)
        requires_photo: f.requires_photo !== false,
        requires_text: f.requires_text !== false,
        optional: !!f.optional,
        optional_photo: !!f.optional_photo,
        optional_text: !!f.optional_text,
        // passthrough extras if you need them later
        base_image: f.base_image || null,
      };
    });

    return res.status(200).json({ records });
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', details: String(err && err.message || err) });
  }
};
