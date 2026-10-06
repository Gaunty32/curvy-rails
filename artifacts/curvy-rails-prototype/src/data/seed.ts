import { ALL_SIZES, PRODUCT_PRICES, type Product } from './types';

const tee = 'Heavyweight cotton tee cut generously through the body, with room at the bust, hip and arm. Printed graphic, pre-washed, made for sizes 16-32.';
const hood = 'Brushed-back fleece hoodie with a roomy hood, longer body and sleeves that actually reach. Printed graphic, made for sizes 16-32.';
const mk = (n: number, name: string, category: 'tshirt' | 'hoodie', colour: 'Black' | 'White', img: string, description: string): Product => ({
  id: `p${n}`,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  name, category, colour,
  price: PRODUCT_PRICES[category],
  sizes: [...ALL_SIZES],
  description, image: `assets/${img}.jpg`, placeholder: true,
});

export const FIRST_PRODUCT: Product = {
  id: 'patience-sold-separately',
  slug: 'patience-sold-separately-t-shirt',
  name: 'Patience Sold Separately T-Shirt',
  category: 'tshirt',
  colour: 'White',
  price: PRODUCT_PRICES.tshirt,
  sizes: [...ALL_SIZES],
  description: 'Our “Patience Sold Separately” T-shirt, available in Black or White. The white option has the black-and-pink design; the black option has the cream-and-pink version. Available in two size options: 16-24 and 26-32. View the flat shot and model mock-up for each colour.',
  image: 'assets/patience-sold-separately.webp',
  images: ['assets/patience-sold-separately.webp', 'assets/patience-sold-separately-model.webp'],
  variants: [
    { colour: 'White', image: 'assets/patience-sold-separately.webp', images: ['assets/patience-sold-separately.webp', 'assets/patience-sold-separately-model.webp'] },
    { colour: 'Black', image: 'assets/patience-sold-separately-black.webp', images: ['assets/patience-sold-separately-black.webp', 'assets/patience-sold-separately-black-model.webp'], artwork: 'assets/patience-sold-separately-cream-artwork.png' },
  ],
  placeholder: false,
  mockup: true,
};

export const SEED_PRODUCTS: Product[] = [
  FIRST_PRODUCT,
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
