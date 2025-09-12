// /api/templates.js
export default async function handler(req, res) {
  const q = req.query || {};
  const slugifyId = q.slug === "1" || q.slug === "true";
  const kebabType = q.type === "kebab"; // kebab-case TYPE

  res.setHeader("access-control-allow-origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME = "Templates" } = process.env;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: "Missing env variables" });
  }

  const base = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const params = new URLSearchParams({ filterByFormula: "AND({active}=TRUE())", pageSize: "100" });
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}` };

  const clean = (s) => (typeof s === "string" ? s.trim() : s);
  const toKebab = (s) =>
    clean(s)?.toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const bestId = (f) => clean(f.template_id) || clean(f.SKU) || clean(f.sku_pattern) || clean(f.name) || null;

  const mapLegacy = (rec) => {
    const f = rec.fields || {};

    // Parse fields_json into an array/object if present
    let fields;
    try {
      if (Array.isArray(f.fields_json)) fields = f.fields_json;
      else if (typeof f.fields_json === "string") fields = JSON.parse(f.fields_json);
    } catch (_) { /* ignore bad JSON */ }

    // template_id
    let id = bestId(f);
    if (slugifyId && id) {
      const slug = toKebab(id);
      id = slug.startsWith("tpl-") ? slug : `tpl-${slug}`;
    }

    // TYPE
    let typeOut = clean(f.TYPE ?? null);
    if (kebabType && typeOut) typeOut = toKebab(typeOut);

    // Build EXACT legacy-shaped object (no extras)
    const out = {
      template_id: id,
      TYPE: typeOut ?? null,
      sku_pattern: clean(f.sku_pattern) ?? null,
      name: clean(f.name) ?? null,
      SKU: clean(f.SKU) ?? null
    };
    if (fields !== undefined) out.fields = fields; // include only if present
    return out;
  };

  async function fetchAll() {
    let url = `${base}?${params.toString()}`;
    const out = [];
    while (url) {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`Airtable ${r.status}`);
      const body = await r.json();
      (body.records || []).forEach((rec) => out.push(mapLegacy(rec)));
      url = body.offset ? `${base}?${params.toString()}&offset=${body.offset}` : "";
    }
    return out;
  }

  try {
    const records = await fetchAll();
    res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({ records });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Upstream error" });
  }
}
