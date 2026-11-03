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
};
