/**
 * Route an image URL through the server-side proxy so that external images
 * (e.g. WooCommerce wp-content URLs) aren't blocked by hotlink protection
 * when the browser requests them directly from a different domain.
 *
 * Internal / relative URLs (starting with "/") are returned unchanged.
 */
export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return url; // already a local/storage URL — no proxy needed
  return `/api/shop/image-proxy?url=${encodeURIComponent(url)}`;
}
