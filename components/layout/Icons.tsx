// A small line-icon set for the shell. Each icon is a 24-unit box drawn with
// the current colour, so the sidebar tints them by state.
type P = { className?: string; style?: React.CSSProperties };

const base = (props: P, children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={props.className} style={props.style} aria-hidden>
    {children}
  </svg>
);

export const Icon = {
  home: (p: P) => base(p, <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" /></>),
  chart: (p: P) => base(p, <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-5 3 3 5-7" /></>),
  layers: (p: P) => base(p, <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  list: (p: P) => base(p, <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>),
  coins: (p: P) => base(p, <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M3 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><path d="M15 9.5c3.3 0 6 1.3 6 3v5c0 1.7-2.7 3-6 3" /></>),
  wallet: (p: P) => base(p, <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" /><path d="M16 14h.01" /></>),
  brain: (p: P) => base(p, <><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V6a2 2 0 0 0-3-2Z" /><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0V6a2 2 0 0 1 3-2Z" /></>),
  shield: (p: P) => base(p, <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>),
  target: (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  scale: (p: P) => base(p, <><path d="M12 3v18" /><path d="M5 7h14" /><path d="m5 7-3 7a3 3 0 0 0 6 0L5 7Z" /><path d="m19 7-3 7a3 3 0 0 0 6 0l-3-7Z" /></>),
  eye: (p: P) => base(p, <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  compass: (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 6-4 0 2-6 4 0Z" /></>),
  receipt: (p: P) => base(p, <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>),
  calculator: (p: P) => base(p, <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>),
  book: (p: P) => base(p, <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 0 2 2h13" /></>),
  gem: (p: P) => base(p, <><path d="m6 4 12 0 3 5-9 11L3 9l3-5Z" /><path d="M3 9h18" /><path d="m9 4 3 5 3-5" /></>),
  file: (p: P) => base(p, <><path d="M7 3h7l5 5v13H7V3Z" /><path d="M14 3v5h5" /></>),
  gear: (p: P) => base(p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.1a1 1 0 0 0-.9.6Z" /></>),
  plus: (p: P) => base(p, <><path d="M12 5v14M5 12h14" /></>),
  sun: (p: P) => base(p, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: (p: P) => base(p, <><path d="M21 13A8 8 0 0 1 11 3a8 8 0 1 0 10 10Z" /></>),
  logout: (p: P) => base(p, <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></>),
  chevron: (p: P) => base(p, <><path d="m6 9 6 6 6-6" /></>),
  menu: (p: P) => base(p, <><path d="M4 7h16M4 12h16M4 17h16" /></>),
  search: (p: P) => base(p, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  trend: (p: P) => base(p, <><path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" /></>),
  briefcase: (p: P) => base(p, <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>),
  sidebar: (p: P) => base(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>),
  bell: (p: P) => base(p, <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>),
  grid: (p: P) => base(p, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  more: (p: P) => base(p, <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>),
  arrowUpRight: (p: P) => base(p, <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>),
  arrowDownRight: (p: P) => base(p, <><path d="M7 7l10 10" /><path d="M17 8v9H8" /></>),
};

export type IconName = keyof typeof Icon;
