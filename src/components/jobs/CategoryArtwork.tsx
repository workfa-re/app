"use client";

import { useState } from "react";
import { getCategoryById } from "@/lib/constants/jobCategories";
import styles from "./CategoryArtwork.module.css";

// Add approved category illustrations here; other categories retain their
// matching vector symbol instead of borrowing an unrelated illustration.
const CATEGORY_ARTWORK: Partial<Record<string, { still: string; motion?: string }>> = {
    garden: { still: "/illustrations/categories/garden-motion-poster-v1.webp", motion: "/illustrations/categories/garden-motion-v1.webp" },
};

interface CategoryArtworkProps {
    categoryId?: string | null;
    previewImageUrl?: string | null;
    className?: string;
}

export function CategoryArtwork({ categoryId, previewImageUrl, className = "" }: CategoryArtworkProps) {
    const category = getCategoryById(categoryId) ?? getCategoryById("other")!;
    const CategoryIcon = category.icon;
    const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
    const photo = previewImageUrl && !failedSources.has(previewImageUrl) ? previewImageUrl : null;
    const artwork = CATEGORY_ARTWORK[category.id];
    const still = artwork && !failedSources.has(artwork.still) ? artwork.still : null;
    const motion = !photo && still && artwork?.motion && !failedSources.has(artwork.motion) ? artwork.motion : null;
    const markFailed = (source: string) => setFailedSources(current => new Set(current).add(source));
    const symbol = (compact = false) => still ? <picture className={styles.symbol}>
        {!compact && motion ? <source type="image/webp" media="(prefers-reduced-motion: no-preference)" srcSet={motion} /> : null}
        <img src={still} alt="" loading="lazy" decoding="async" width={128} height={128}
            onError={event => markFailed(motion && event.currentTarget.currentSrc.endsWith(motion) ? motion : still)} />
    </picture> : <CategoryIcon size={compact ? 16 : 32} strokeWidth={1.45} aria-hidden="true" />;

    return <span className={`${styles.artwork} ${className}`} data-photo={Boolean(photo) || undefined}
        role="img" aria-label={photo ? `Foto zur Aufgabe · ${category.label}` : category.label}>
        <span className={styles.visual} aria-hidden="true">
            {photo ? <img className={styles.photo} src={photo} alt="" loading="lazy" decoding="async" width={128} height={128}
                onError={() => markFailed(photo)} /> : symbol()}
        </span>
        {photo ? <span className={styles.badge} aria-hidden="true">{symbol(true)}</span> : null}
    </span>;
}
