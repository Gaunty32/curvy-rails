export type ProductSort =
  | 'default'
  | 'popularity'
  | 'latest'
  | 'price-asc'
  | 'price-desc';

function productPrice(product: any): number {
  const value = product.salePrice ?? product.price ?? 0;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function productUpdatedAt(product: any): number {
  const timestamp = product.updatedAt ? Date.parse(String(product.updatedAt)) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number(product.id) || 0;
}

function compareNames(left: any, right: any): number {
  return String(left.name ?? '').localeCompare(String(right.name ?? ''), undefined, {
    sensitivity: 'base',
  });
}

export function sortProducts(products: any[], sort: ProductSort): any[] {
  const sorted = [...products];

  switch (sort) {
    case 'popularity':
      return sorted.sort((left, right) =>
        (Number(right.popularity) || 0) - (Number(left.popularity) || 0)
        || compareNames(left, right)
      );
    case 'latest':
      return sorted.sort((left, right) =>
        productUpdatedAt(right) - productUpdatedAt(left)
        || compareNames(left, right)
      );
    case 'price-asc':
      return sorted.sort((left, right) =>
        productPrice(left) - productPrice(right)
        || compareNames(left, right)
      );
    case 'price-desc':
      return sorted.sort((left, right) =>
        productPrice(right) - productPrice(left)
        || compareNames(left, right)
      );
    case 'default':
    default:
      return sorted;
  }
}