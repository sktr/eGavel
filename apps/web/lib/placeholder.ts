export interface PlaceholderStyle {
  icon: string
  bg: string
  fg: string
}

/** Category value → material icon + tinted colors (categories from create/page.tsx). */
export const CATEGORY_PLACEHOLDERS: Record<string, PlaceholderStyle> = {
  art: { icon: "palette", bg: "#fdf0f2", fg: "#c2567a" },
  collectibles: { icon: "diamond", bg: "#f4f0fb", fg: "#7a5bb0" },
  watches: { icon: "watch", bg: "#eef2fb", fg: "#3e6bd6" },
  bags: { icon: "checkroom", bg: "#f7f0e8", fg: "#9a6b3a" },
  jewelry: { icon: "diamond", bg: "#f4f0fb", fg: "#7a5bb0" },
  wine: { icon: "wine_bar", bg: "#fbecec", fg: "#b04444" },
  cars: { icon: "directions_car", bg: "#eef2fb", fg: "#3e6bd6" },
  furniture: { icon: "chair", bg: "#faf0e2", fg: "#b3813a" },
  electronics: { icon: "memory", bg: "#eef0f2", fg: "#5c6672" },
  other: { icon: "inventory_2", bg: "#f0f1f3", fg: "#6b7280" },
}

export function placeholderFor(category?: string): PlaceholderStyle {
  return CATEGORY_PLACEHOLDERS[category ?? ""] ?? CATEGORY_PLACEHOLDERS.other!
}

export function itemInitial(name?: string): string {
  const c = (name ?? "").trim().charAt(0)
  return c ? c.toUpperCase() : "?"
}
