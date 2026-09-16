"use client";

import Image from "next/image";
import { BRAND_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

type ThemedLogoImageProps = {
  alt?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

const darkLogoSrc = "/brand/workfare-mark-dark.png";
const lightLogoSrc = "/brand/workfare-mark-light.png";

export function ThemedLogoImage({
  alt = BRAND_NAME,
  width,
  height,
  fill = false,
  className,
  priority,
  sizes,
}: ThemedLogoImageProps) {
  const imageClassName = cn("theme-logo-image", className);

  if (fill) {
    const responsiveSizes = sizes ?? "64px";
    return (
      <>
        <Image
          src={darkLogoSrc}
          alt={alt}
          fill
          sizes={responsiveSizes}
          priority={priority}
          className={cn("theme-logo-dark", imageClassName)}
        />
        <Image
          src={lightLogoSrc}
          alt=""
          fill
          sizes={responsiveSizes}
          priority={priority}
          aria-hidden="true"
          className={cn("theme-logo-light", imageClassName)}
        />
      </>
    );
  }

  return (
    <>
      <Image
        src={darkLogoSrc}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={cn("theme-logo-dark", imageClassName)}
      />
      <Image
        src={lightLogoSrc}
        alt=""
        width={width}
        height={height}
        priority={priority}
        aria-hidden="true"
        className={cn("theme-logo-light", imageClassName)}
      />
    </>
  );
}
