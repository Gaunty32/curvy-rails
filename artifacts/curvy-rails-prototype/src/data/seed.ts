import { ALL_SIZES, type Product } from './types';

const tee = 'Heavyweight cotton tee cut generously through the body, with room at the bust, hip and arm. Printed graphic, pre-washed, made for sizes 16-32.';
const hood = 'Brushed-back fleece hoodie with a roomy hood, longer body and sleeves that actually reach. Printed graphic, made for sizes 16-32.';
const mk = (n: number, name: string, category: 'tshirt' | 'hoodie', colour: 'Black' | 'White', img: string, description: string): Product => ({
  id: `p${n}`,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  name, category, colour,
  price: category === 'tshirt' ? 24 : 38,
  sizes: [...ALL_SIZES],
  description, image: `assets/${img}.jpg`, placeholder: true,
});

export const SEED_PRODUCTS: Product[] = [
  mk(1, 'Curvy Rails T-Shirt Black', 'tshirt', 'Black', 'p1', tee),
  mk(2, 'Curvy Rails T-Shirt White', 'tshirt', 'White', 'p2', tee),
  mk(3, 'Curvy Rails Hoodie Black', 'hoodie', 'Black', 'p3', hood),
  mk(4, 'Curvy Rails Hoodie White', 'hoodie', 'White', 'p4', hood),
  mk(5, 'Confidence Club T-Shirt', 'tshirt', 'Black', 'p5', tee),
  mk(6, 'Good Clothes Brighter Days T-Shirt', 'tshirt', 'White', 'p6', tee),
  mk(7, 'Confidence Club Hoodie', 'hoodie', 'Black', 'p3', hood),
  mk(8, 'Brighter Days Hoodie', 'hoodie', 'White', 'p4', hood),
  mk(9, 'Stick Around T-Shirt', 'tshirt', 'Black', 'p1', tee),
  mk(10, 'Real Curves T-Shirt', 'tshirt', 'White', 'p2', tee),
];
