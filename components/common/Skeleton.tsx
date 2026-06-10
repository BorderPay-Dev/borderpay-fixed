/**
 * Skeleton — instant-mount placeholders for loading states.
 *
 * Native apps never show a blank screen or a centered spinner while data
 * loads — they paint the *shape* of the content immediately, then swap in real
 * values. These primitives give every screen that feel:
 *
 *   <Skeleton className="h-4 w-32" />        // a single shimmer block
 *   <SkeletonText lines={3} />               // stacked text lines
 *   <SkeletonRow />                          // a list/transaction row
 *   <SkeletonCard />                         // a card block
 *
 * The shimmer uses the shared `.frame-loading` keyframes already in
 * globals.css, so it matches the rest of the app and adds no new CSS.
 *
 * Pattern: seed state from cache on first render, render Skeletons only when
 * there is genuinely nothing to show yet, and never block the whole screen on
 * a spinner.
 */

import React from 'react';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`frame-loading rounded-lg bg-white/[0.05] ${className}`}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/** A transaction / list row: round icon + two stacked lines + trailing amount. */
export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 ${className}`}
      aria-hidden="true"
    >
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

/** A generic card block. Pass a height via className (default h-24). */
export function SkeletonCard({ className = 'h-24' }: { className?: string }) {
  return (
    <Skeleton className={`w-full rounded-2xl ${className}`} />
  );
}

/** N stacked rows — convenience for lists. */
export function SkeletonRows({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export default Skeleton;
