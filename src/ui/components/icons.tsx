// Inline stroke icons (24x24 grid, currentColor).

import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const IconPointer = () => (
  <Icon>
    <path d="M5 3l14 8-6 2-2 6z" />
  </Icon>
);
export const IconPlus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconTrash = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const IconUndo = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </Icon>
);
export const IconRedo = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 000 10h3" />
  </Icon>
);
export const IconPlay = () => (
  <Icon>
    <path d="M7 4l13 8-13 8z" fill="currentColor" />
  </Icon>
);
export const IconPause = () => (
  <Icon>
    <path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" />
  </Icon>
);
export const IconRestart = () => (
  <Icon>
    <path d="M4 4v6h6" />
    <path d="M20 12a8 8 0 10-2.3 5.6M4 10a8 8 0 012-3.3" />
  </Icon>
);
export const IconCode = () => (
  <Icon>
    <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
  </Icon>
);
export const IconHelp = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
  </Icon>
);
export const IconFit = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const IconMagnet = () => (
  <Icon>
    <path d="M6 3v8a6 6 0 0012 0V3M6 7h4M14 7h4" />
  </Icon>
);
export const IconCopy = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h8" />
  </Icon>
);
export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const IconUpload = () => (
  <Icon>
    <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />
  </Icon>
);
export const IconDuplicate = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Icon>
);
export const IconUp = () => (
  <Icon size={14}>
    <path d="M6 15l6-6 6 6" />
  </Icon>
);
export const IconDown = () => (
  <Icon size={14}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const IconX = () => (
  <Icon size={14}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const IconChevronLeft = () => (
  <Icon size={16}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);
export const IconChevronRight = () => (
  <Icon size={16}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const IconMirror = () => (
  <Icon>
    <path d="M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5" />
  </Icon>
);
export const IconSun = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const IconMoon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </Icon>
);
export const IconMonitor = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);
export const IconLine = () => (
  <Icon>
    <path d="M4 18L20 6" />
    <circle cx="4" cy="18" r="1.5" fill="currentColor" />
    <circle cx="20" cy="6" r="1.5" fill="currentColor" />
  </Icon>
);
export const IconCurve = () => (
  <Icon>
    <path d="M4 18C8 4 16 20 20 6" />
  </Icon>
);
export const IconRuler = () => (
  <Icon>
    <path d="M3 17L17 3l4 4L7 21z" />
    <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
  </Icon>
);
export const IconPanelLeft = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);
export const IconPanelRight = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Icon>
);
export const IconChart = () => (
  <Icon>
    <path d="M4 19h16M5 15l4-5 4 3 6-7" />
  </Icon>
);
export const IconMore = () => (
  <Icon>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
  </Icon>
);
