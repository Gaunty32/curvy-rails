export type Category = 'tshirt' | 'hoodie';
export type ProductColour = 'Black' | 'White';
export interface ProductVariant {
  colour: ProductColour;
  image: string;
  images: string[];
  /** Production artwork for this colour, separate from the garment mock-ups. */
  artwork?: string;
}
export const PRODUCT_PRICES: Record<Category, number> = { tshirt: 20, hoodie: 35 };
export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  colour: ProductColour;
  price: number;
  sizes: string[];
  description: string;
  image: string;
  images?: string[];
  variants?: ProductVariant[];
  mockup?: boolean;
  /** Demo flag: placeholder imagery that the real catalogue will replace. */
  placeholder: boolean;
}
export function productColours(product: Product): ProductColour[] {
  return product.variants?.length ? product.variants.map((v) => v.colour) : [product.colour];
}
export function productForColour(product: Product, colour: ProductColour): Product {
  const variant = product.variants?.find((v) => v.colour === colour);
  return variant ? { ...product, colour: variant.colour, image: variant.image, images: variant.images } : product;
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
