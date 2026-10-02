export type Category = 'tshirt' | 'hoodie';
export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  colour: 'Black' | 'White';
  price: number;
  sizes: number[];
  description: string;
  image: string;
  images?: string[];
  mockup?: boolean;
  /** Demo flag: placeholder imagery that the real catalogue will replace. */
  placeholder: boolean;
}
export const ALL_SIZES = [16, 18, 20, 22, 24, 26, 28, 30, 32];
export const CATEGORY_LABEL: Record<Category, string> = { tshirt: 'T-Shirt', hoodie: 'Hoodie' };
