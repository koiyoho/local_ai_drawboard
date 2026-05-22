import { useEffect, useState } from "react";

const konvaImageCache = new Map<string, HTMLImageElement>();

export function useKonvaImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      setError(null);
      return;
    }

    const cachedImage = konvaImageCache.get(src);
    if (cachedImage?.complete) {
      setImage(cachedImage);
      setError(null);
      return;
    }

    let cancelled = false;
    const nextImage = new Image();
    nextImage.decoding = "async";

    setImage(null);
    setError(null);

    nextImage.onload = () => {
      if (cancelled) return;
      konvaImageCache.set(src, nextImage);
      setImage(nextImage);
    };
    nextImage.onerror = () => {
      if (cancelled) return;
      setImage(null);
      setError(new Error("Failed to load image"));
    };
    nextImage.src = src;

    return () => {
      cancelled = true;
      nextImage.onload = null;
      nextImage.onerror = null;
    };
  }, [src]);

  return { error, image };
}
