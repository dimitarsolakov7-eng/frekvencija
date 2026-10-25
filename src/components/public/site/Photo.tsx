import Image, { type ImageProps, type StaticImageData } from "next/image";

export type PhotoProps = Omit<ImageProps, "placeholder" | "src"> & {
  src: StaticImageData | string;
};

/**
 * next/image for the website's photography: statically imported photos get their blurred placeholder,
 * plain paths (and test environments, where an import is just a path) load without one.
 */
export function Photo({ src, alt, ...props }: PhotoProps) {
  const blur = typeof src === "object" && src !== null && "blurDataURL" in src && src.blurDataURL ? "blur" : "empty";
  return <Image src={src} alt={alt} placeholder={blur} draggable={false} {...props} />;
}
