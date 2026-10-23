"use client";

import { useState } from "react";
import { profileInitials } from "./public-profile";

export function ProfileAvatar({ url, name, className }: { url: string | null; name: string; className: string }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    return <span className={className} aria-hidden="true">
        {url && failedUrl !== url
            ? <img src={url} alt="" decoding="async" onError={() => setFailedUrl(url)} />
            : <span>{profileInitials(name)}</span>}
    </span>;
}
