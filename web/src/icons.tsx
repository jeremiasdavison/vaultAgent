import type { ReactNode } from "react";

export function KeyMark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="18" cy="18" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="18" cy="18" r="3.5" fill="currentColor" />
      <path d="M26 22 L42 38 M34 38 H42 V30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  stack: () => <Svg><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></Svg>,
  folder: () => <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Svg>,
  shared: () => <Svg><circle cx="8" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M14 15.2c2.6-.4 4.6.9 5.3 3.8" /></Svg>,
  search: () => <Svg><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>,
  plus: () => <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  logout: () => <Svg><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></Svg>,
  lock: () => <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  unlock: () => <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Svg>,
  key: () => <Svg><circle cx="8" cy="8" r="4.5" /><path d="m11.5 11.5 8 8M16 19.5h3.5V16" /></Svg>,
  terminal: () => <Svg><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7 10 3 2.5L7 15M12.5 15H17" /></Svg>,
  copy: () => <Svg><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>,
  check: () => <Svg><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>,
  github: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  ),
};
