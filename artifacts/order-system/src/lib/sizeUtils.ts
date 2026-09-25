const SIZE_ORDER = [
  "XXXS", "XXS", "3XS", "2XS",
  "XS",   "X-Small", "X Small", "XSmall", "Extra Small", "ExtraSmall",
  "S",    "Small",
  "M",    "Medium",
  "L",    "Large",
  "XL",   "X-Large", "X Large", "XLarge", "Extra Large", "ExtraLarge",
  "2XL",  "XXL",  "XX-Large", "XX Large",  "XXLarge",
  "3XL",  "XXXL", "XXX-Large", "XXX Large", "XXXLarge",
  "4XL",  "XXXXL",
  "5XL",
  "6XL", "7XL", "8XL",
  // Numeric clothing/shoe sizes are intentionally NOT listed here.
  // They fall through to the numeric fallback (500 + num) so that ALL numeric
  // sizes — even UK dress sizes (4, 6, 8…) and shoe sizes (3, 5, 6.5, 7…) —
  // sort together in ascending numerical order rather than splitting into
  // "listed evens first, unlisted odds last".
  "Extra Small Youth", "ExtraSmallYouth", "XS Youth", "XSY",
  "Small Youth",       "SmallYouth",      "S Youth",  "SY",
  "Medium Youth",      "MediumYouth",     "M Youth",  "MY",
  "Large Youth",       "LargeYouth",      "L Youth",  "LY",
  "Extra Large Youth", "ExtraLargeYouth", "XL Youth", "XLY",
  "2XL Youth", "XXL Youth",
  "One Size","One-Size","Onesize","Free Size","Universal","N/A",
];

function normalise(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

function baseRank(token: string): number {
  const n = normalise(token);
  const idx = SIZE_ORDER.findIndex(r => normalise(r) === n);
  if (idx !== -1) return idx;
  // Pure numeric sizes (shoe sizes, collar sizes like 14.0, waist sizes, etc.) — sort numerically
  const num = parseFloat(n);
  if (!isNaN(num) && /^\d+(\.\d+)?$/.test(n)) return 500 + num;
  return 9999;
}

export function sizeRank(s: string | null | undefined): number {
  if (!s) return 9999;
  const parts = s.split(/[\/\-]/).map(p => p.trim()).filter(Boolean);
  return Math.min(...parts.map(baseRank));
}

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const diff = sizeRank(a) - sizeRank(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

/** Map of normalised long-form size names → short display label for tight grids */
const SIZE_ABBREV: Record<string, string> = {
  "EXTRASMALL": "XS", "XSMALL": "XS", "X-SMALL": "XS", "EXTRA SMALL": "XS",
  "SMALL": "S",
  "MEDIUM": "M",
  "LARGE": "L",
  "XLARGE": "XL", "X-LARGE": "XL", "EXTRALARGE": "XL", "EXTRA LARGE": "XL",
  "XXSMALL": "XXS", "2XSMALL": "XXS",
  "XXXSMALL": "3XS", "3XSMALL": "3XS",
  "XXLARGE": "2XL", "2XLARGE": "2XL",
  "XXXLARGE": "3XL", "3XLARGE": "3XL",
  "XXXXLARGE": "4XL", "4XLARGE": "4XL",
  "XXXXXLARGE": "5XL", "5XLARGE": "5XL",
  "EXTRASMALL YOUTH": "XS Youth", "XSYOUTH": "XS Youth",
  "SMALL YOUTH": "S Youth", "SYOUTH": "S Youth",
  "MEDIUM YOUTH": "M Youth", "MYOUTH": "M Youth",
  "LARGE YOUTH": "L Youth", "LYOUTH": "L Youth",
  "EXTRALARGE YOUTH": "XL Youth", "XLYOUTH": "XL Youth",
  "ONESIZE": "One Size", "ONE-SIZE": "One Size", "FREESIZE": "Free Size",
};

/** Returns a short display label for size grids where column width is tight. */
export function abbreviateSizeLabel(s: string): string {
  const key = s.trim().toUpperCase().replace(/\s+/g, " ");
  const compactKey = key.replace(/\s+/g, "");
  return SIZE_ABBREV[key] ?? SIZE_ABBREV[compactKey] ?? s;
}

export function sortBySize<T>(arr: T[], key: (item: T) => string | null | undefined): T[] {
  return [...arr].sort((a, b) => {
    const diff = sizeRank(key(a)) - sizeRank(key(b));
    if (diff !== 0) return diff;
    return (key(a) ?? "").localeCompare(key(b) ?? "");
  });
}

/** Sort using a custom user-defined order. Falls back to built-in ranking for sizes not in the list. */
export function sortSizesWithOrder(sizes: string[], customOrder: string[]): string[] {
  if (customOrder.length === 0) return sortSizes(sizes);
  return [...sizes].sort((a, b) => {
    const ia = customOrder.findIndex(o => normalise(o) === normalise(a));
    const ib = customOrder.findIndex(o => normalise(o) === normalise(b));
    const ra = ia !== -1 ? ia : 10000 + sizeRank(a);
    const rb = ib !== -1 ? ib : 10000 + sizeRank(b);
    return ra - rb || a.localeCompare(b);
  });
}

export function sortBySizeWithOrder<T>(
  arr: T[],
  key: (item: T) => string | null | undefined,
  customOrder: string[],
): T[] {
  if (customOrder.length === 0) return sortBySize(arr, key);
  return [...arr].sort((a, b) => {
    const sa = key(a) ?? "";
    const sb = key(b) ?? "";
    const ia = customOrder.findIndex(o => normalise(o) === normalise(sa));
    const ib = customOrder.findIndex(o => normalise(o) === normalise(sb));
    const ra = ia !== -1 ? ia : 10000 + sizeRank(sa);
    const rb = ib !== -1 ? ib : 10000 + sizeRank(sb);
    return ra - rb || sa.localeCompare(sb);
  });
}
