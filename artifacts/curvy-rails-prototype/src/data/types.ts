export type Category = 'tshirt' | 'hoodie';
export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  colour: 'Black' | 'White';
  price: number;
  sizes: string[];
  description: string;
  image: string;
  images?: string[];
  mockup?: boolean;
  /** Demo flag: placeholder imagery that the real catalogue will replace. */
  placeholder: boolean;
}
export const ALL_SIZES = ['16-24', '26-32'];
/** Upgrade old individual UK sizes to the brand's two size options. */
export function normalizeSize(size: string | number): string {
  const n = typeof size === 'number' ? size : /^\d+$/.test(size) ? Number(size) : null;
  if (n !== null && n >= 16 && n <= 24) return '16-24';
  if (n !== null && n >= 26 && n <= 32) return '26-32';
  return String(size);
}
export const CATEGORY_LABEL: Record<Category, string> = { tshirt: 'T-Shirt', hoodie: 'Hoodie' };
