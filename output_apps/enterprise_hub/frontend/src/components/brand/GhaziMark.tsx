import type { SVGProps } from 'react';

/**
 * Brand mark of «قاضی هوشمند»: a round emblem with scales of justice and a diagonal
 * gavel, stroke gradient cyan -> gold (derived from /brand/ghazi-emblem.webp).
 * Thin strokes, readable down to 24px. Pure SVG, no client JS. Decorative by default
 * (the visible brand name sits next to it); pass `title` to expose it to screen readers.
 */
export function GhaziMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      <defs>
        <linearGradient id="ghazi-mark-g" x1="4" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.45" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#fde68a" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="29" stroke="url(#ghazi-mark-g)" strokeWidth="2" />
      <g stroke="url(#ghazi-mark-g)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* scales */}
        <path d="M32 12v32M23 47h18M16 21h32" />
        <path d="M16 21 10 34M16 21l6 13M48 21l-6 13M48 21l6 13" strokeWidth="1.5" />
        <path d="M9 34h14c0 4-3 7-7 7s-7-3-7-7ZM41 34h14c0 4-3 7-7 7s-7-3-7-7Z" strokeWidth="1.75" />
        {/* gavel: dark knock-out under the handle keeps it readable over the scales */}
        <path d="M18 50 40 28" stroke="#05080f" strokeWidth="6" />
        <path d="M18 50 40 28" />
        <rect x="35" y="14.5" width="16" height="8" rx="2" transform="rotate(45 43 18.5)" fill="#05080f" />
      </g>
    </svg>
  );
}
