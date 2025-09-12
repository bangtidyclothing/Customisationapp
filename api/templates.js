export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME = "Templates" } = process.env;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: "Missing env variables" });
  }

  async function fetchAll() {
    const base = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
    const params = new URLSearchParams({ filterByFormula: "AND({active}=TRUE())", pageSize: "100" });
    const headers = { Authorization: `Bearer ${AIRTABLE_API_KEY}` };

    let url = `${base}?${params.toString()}`;
    const out = [];

    while (url) {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`Airtable ${r.status}`);
      const body = await r.json();

      (body.records || []).forEach((rec) => {
        const f = rec.fields || {};
        const parse = (val) => {
          if (!val || typeof val !== "string") return undefined;
          try { return JSON.parse(val); } catch { return undefined; }
        };
        out.push({
          template_id: f.template_id ?? rec.id,
          TYPE: f.TYPE ?? null,
          sku_pattern: f.sku_pattern ?? null,
          name: f.name ?? null,
          SKU: f.SKU ?? null,
          fields: parse(f.fields_json),
          hero: f.hero ?? null,
          units_per_sheet: typeof f.units_per_sheet === "number" ? f.units_per_sheet : undefined,
          print_spec: parse(f.print_spec_json),
          imposition: parse(f.imposition_json),
          output_pattern: f.output_pattern ?? null
        });
      });

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
