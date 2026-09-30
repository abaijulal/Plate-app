import { checkPasscode } from "./_auth.js";

// Looks up a product in Open Food Facts (free, open database).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  if (!checkPasscode(req, res)) return;

  const code = String(req.query.code || "").replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) return res.status(400).json({ error: "bad_code" });

  let r;
  try {
    r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,serving_size,nutriments`,
      { headers: { "User-Agent": "PlateApp/1.0 (personal calorie tracker)" } }
    );
  } catch {
    return res.status(200).json({ found: false });
  }
  if (!r.ok) return res.status(200).json({ found: false });

  const j = await r.json().catch(() => null);
  const p = j && j.status === 1 ? j.product : null;
  if (!p) return res.status(200).json({ found: false });

  const n = p.nutriments || {};
  const perServing = n["energy-kcal_serving"] != null;
  let kcal = perServing ? n["energy-kcal_serving"] : n["energy-kcal_100g"];
  if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184; // kJ -> kcal
  if (kcal == null) return res.status(200).json({ found: false });

  const g = k => Math.round((+(perServing ? n[`${k}_serving`] : n[`${k}_100g`]) || 0) * 10) / 10;
  const brand = String(p.brands || "").split(",")[0].trim();
  const name = [brand, p.product_name].filter(Boolean).join(" ").trim() || `Product ${code}`;

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({
    found: true,
    name: name.slice(0, 60),
    serving: perServing ? p.serving_size || "1 serving" : "100 g",
    per100g: !perServing,
    calories: Math.round(kcal),
    protein_g: g("proteins"),
    carbs_g: g("carbohydrates"),
    fat_g: g("fat"),
  });
}
