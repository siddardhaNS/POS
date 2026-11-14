/** Guest-facing menu details shared by the POS, the menu editor and the table QR page. */

export const ALLERGEN_LABEL: Record<string, string> = {
  gluten: "Gluten", milk: "Milk", eggs: "Eggs", peanuts: "Peanuts", tree_nuts: "Tree nuts", soy: "Soy", sesame: "Sesame",
  mustard: "Mustard", fish: "Fish", crustaceans: "Shellfish", molluscs: "Molluscs", celery: "Celery", sulphites: "Sulphites",
  lupin: "Lupin",
};

export const SUGGESTED_TAGS = ["Chef's special", "Bestseller", "Spicy", "Mild", "Vegan", "Jain", "Gluten-free", "Contains egg", "New", "Kids"];

export interface Nutrition { kcal?: number; protein?: number; carbs?: number; fat?: number }

export const NUTRIENTS: { k: keyof Nutrition; l: string; unit: string }[] = [
  { k: "kcal", l: "Calories", unit: "kcal" },
  { k: "protein", l: "Protein", unit: "g" },
  { k: "carbs", l: "Carbs", unit: "g" },
  { k: "fat", l: "Fat", unit: "g" },
];

/** "520 kcal · 18 g protein" (only what was filled in). */
export function nutritionLine(n: Nutrition | undefined) {
  if (!n) return "";
  return NUTRIENTS.filter(({ k }) => n[k] != null).map(({ k, l, unit }) => (k === "kcal" ? `${n[k]} kcal` : `${n[k]} g ${l.toLowerCase()}`)).join(" · ");
}

export const allergenList = (a: string[] | undefined) => (a ?? []).map((x) => ALLERGEN_LABEL[x] ?? x).join(", ");
