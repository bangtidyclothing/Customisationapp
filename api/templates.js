// /api/templates.js
// Returns { records: [...] } in legacy shape + parsed `layout` + `base_image`
// Also surfaces requires_photo / requires_text from Airtable.

export default async function handler(req, res) {
  const q = req.query || {};
  const slugifyId = q.slug === "1" || q.slug === "true";
  const kebabType = q.type === "kebab";

  // CORS
  res.setHeader("access-control-allow-origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const {
    AIRTABLE_API_KEY,
    AIRTABLE_BASE_ID,
    AIRTABLE_TABLE_NAME = "Templates",
  } = process.env;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: "Missing env variables" });
  }

  const base = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const params = new URLSearchParams({ filterByFormula: "AND({active}=TRUE())", pageSize: "100" });
  const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}` };

  const clean = (s) => (typeof s === "string" ? s.trim() : s);
  const toKebab = (s) =>
    clean(s)?.toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const bestId = (f) =>
    clean(f.template_id) || clean(f.SKU) || clean(f.sku_pattern) || clean(f.name) || null;

  const firstUrl = (v) => {
    if (!v) return null;
    if (typeof v === "string") return clean(v) || null;
    if (Array.isArray(v) && v.length && v[0] && v[0].url) return v[0].url;
    return null;
  };

  const mapLegacy = (rec) => {
    const f = rec.fields || {};

    // fields_json
    let fields;
    try {
      if (Array.isArray(f.fields_json)) fields = f.fields_json;
      else if (typeof f.fields_json === "string") fields = JSON.parse(f.fields_json);
    } catch (_) {}

    // Layout_spec
    let layout;
    try {
      if (f.Layout_spec && typeof f.Layout_spec === "string") layout = JSON.parse(f.Layout_spec);
      else if (f.Layout_spec && typeof f.Layout_spec === "object") layout = f.Layout_spec;
    } catch (_) {}

    // Base image from base_image / Base_image / hero
    const base_image =
      firstUrl(f.base_image) || firstUrl(f.Base_image) || firstUrl(f.hero) || null;

    // requires flags (booleans)
    const requires_photo = f.requires_photo === true || f.requires_photo === "true";
    const requires_text  = f.requires_text  === true || f.requires_text  === "true";

    // template_id
    let id = bestId(f);
    if (slugifyId && id) {
      const slug = toKebab(id);
      id = slug.startsWith("tpl-") ? slug : `tpl-${slug}`;
    }

    // TYPE
    let typeOut = clean(f.TYPE ?? null);
    if (kebabType && typeOut) typeOut = toKebab(typeOut);

    const out = {
      template_id: id,
      TYPE: typeOut ?? null,
      sku_pattern: clean(f.sku_pattern) ?? null,
      name: clean(f.name) ?? null,
      SKU: clean(f.SKU) ?? null,
      requires_photo,
      requires_text,
    };
    if (fields !== undefined) out.fields = fields;
    if (layout !== undefined) out.layout = layout;
    if (base_image !== null) out.base_image = base_image;

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
