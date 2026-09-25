import { useState } from "react";

interface UploadedImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}

/**
 * Renders an uploaded image. If the image fails to load (broken URL, wrong
 * content-type, PDF stored as logo, etc.) it shows `fallback` instead of
 * browser alt-text.
 */
export function UploadedImage({ src, alt, className, fallback }: UploadedImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
