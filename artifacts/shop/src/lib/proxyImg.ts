/** Proxy only explicitly configured remote image hosts through the API. */
export function proxyImg(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  try {
    const host = new URL(url).hostname;
    const configuredHost = import.meta.env.VITE_PUBLIC_IMAGE_HOST;
    if (configuredHost && host === configuredHost) {
      return `/api/shop/image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return '';
  }
  if (!import.meta.env.VITE_PUBLIC_IMAGE_HOST) return '';
  if (url.includes(import.meta.env.VITE_PUBLIC_IMAGE_HOST)) {
    return `/api/shop/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}
