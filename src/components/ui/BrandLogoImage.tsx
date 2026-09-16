import Image from "next/image";
import { BRAND_ICON_PATH, BRAND_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

type BrandLogoImageProps = {
  alt?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

/** One original Workfare mark, identical in light and dark appearance. */
export function BrandLogoImage({
  alt = BRAND_NAME,
  width,
  height,
  fill = false,
  className,
  priority,
  sizes,
}: BrandLogoImageProps) {
  return (
    <Image
      src={BRAND_ICON_PATH}
      alt={alt}
      {...(fill ? { fill: true, sizes: sizes ?? "64px" } : { width, height, sizes })}
      priority={priority}
      className={cn("brand-logo-image block object-contain", className)}
    />
  );
}
