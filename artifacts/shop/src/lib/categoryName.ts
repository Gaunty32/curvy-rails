const HTML_ENTITY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&amp;/gi, "&"],
  [/&#38;/gi, "&"],
  [/&#x26;/gi, "&"],
  [/&quot;/gi, '"'],
  [/&#39;/gi, "'"],
  [/&apos;/gi, "'"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&nbsp;/gi, " "],
];

export function formatCategoryName(name: string | null | undefined): string {
  return HTML_ENTITY_REPLACEMENTS.reduce(
    (formatted, [pattern, replacement]) => formatted.replace(pattern, replacement),
    name ?? "",
  );
}

export function compareCategoryNames(a: { name?: string | null }, b: { name?: string | null }): number {
  return formatCategoryName(a.name).localeCompare(
    formatCategoryName(b.name),
    "en-GB",
    { sensitivity: "base" },
  );
}