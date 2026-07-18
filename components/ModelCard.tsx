"use client";

import { Box, Download, EyeOff, Heart, Lock } from "lucide-react";
import { useState } from "react";
import type { Visibility } from "@/lib/models/types";

export interface ModelCardProps {
  href: string;
  title: string;
  author?: string;
  likeCount: number;
  downloadCount: number;
  thumbnailUrl: string;
  visibility: Visibility;
}

export function ModelCard({ href, title, author, likeCount, downloadCount, thumbnailUrl, visibility }: ModelCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  return (
    <a className="model-card" href={href}>
      <span className="model-card-thumb">
        {thumbnailFailed
          ? <Box size={34} strokeWidth={1.4} />
          // eslint-disable-next-line @next/next/no-img-element -- immutable same-origin thumbnail endpoint; no next/image transform wanted
          : <img src={thumbnailUrl} alt="" loading="lazy" onError={() => setThumbnailFailed(true)} />}
      </span>
      <span className="model-card-body">
        <strong title={title}>{title}</strong>
        {author ? <span className="model-card-author">by {author}</span> : null}
        <span className="model-card-meta">
          <span><Heart size={12} /> {likeCount}</span>
          <span><Download size={12} /> {downloadCount}</span>
          {visibility === "private" ? <span className="model-card-visibility"><Lock size={12} /> private</span> : null}
          {visibility === "unlisted" ? <span className="model-card-visibility"><EyeOff size={12} /> unlisted</span> : null}
        </span>
      </span>
    </a>
  );
}
