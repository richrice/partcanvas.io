"use client";

import { Box, Download, Eye, EyeOff, Heart, Lock, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { Visibility } from "@/lib/models/types";
import { relativeTime } from "@/lib/relative-time";

export interface ModelCardProps {
  href: string;
  title: string;
  author?: string;
  likeCount: number;
  downloadCount: number;
  commentCount?: number;
  viewCount?: number;
  createdAt?: string;
  thumbnailUrl: string;
  visibility: Visibility;
}

export function ModelCard({ href, title, author, likeCount, downloadCount, commentCount, viewCount, createdAt, thumbnailUrl, visibility }: ModelCardProps) {
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
          <span title="Likes"><Heart size={12} /> {likeCount}</span>
          <span title="Downloads"><Download size={12} /> {downloadCount}</span>
          {commentCount !== undefined && commentCount > 0 ? <span title="Comments"><MessageSquare size={12} /> {commentCount}</span> : null}
          {viewCount !== undefined ? <span title="Views"><Eye size={12} /> {viewCount}</span> : null}
          {visibility === "private" ? <span className="model-card-visibility"><Lock size={12} /> private</span> : null}
          {visibility === "unlisted" ? <span className="model-card-visibility"><EyeOff size={12} /> unlisted</span> : null}
          {createdAt ? <span className="model-card-date" suppressHydrationWarning title={new Date(createdAt).toLocaleString()}>{relativeTime(createdAt)}</span> : null}
        </span>
      </span>
    </a>
  );
}
