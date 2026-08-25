/* A small, consistent icon set. One stroke weight, one grid, no dependency. */

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconSearch = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6" />
  </svg>
);

export const IconCart = ({ size = 17, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 4h2.2l2 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L20.5 8H6" />
    <circle cx="10" cy="20" r="1.3" />
    <circle cx="17.5" cy="20" r="1.3" />
  </svg>
);

export const IconClose = ({ size = 17, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const IconArrow = ({ size = 17, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const IconBack = ({ size = 17, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const IconCheck = ({ size = 17, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 12.5l5 5L19.5 7" />
  </svg>
);

export const IconLock = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </svg>
);

export const IconAlert = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </svg>
);

export const IconCloud = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 18.5A4.2 4.2 0 0 1 7.4 10a5.6 5.6 0 0 1 10.7 1.5A3.6 3.6 0 0 1 17.6 18.5z" />
  </svg>
);

export const IconTruck = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2.5 6.5h11v10h-11z" />
    <path d="M13.5 10h4l3.5 3.5v3h-7.5z" />
    <circle cx="6.5" cy="18.5" r="1.7" />
    <circle cx="16.5" cy="18.5" r="1.7" />
  </svg>
);

export const IconTag = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 11.4V4.5h6.9l8.6 8.6-6.9 6.9z" />
    <circle cx="8" cy="8" r="1.2" />
  </svg>
);

export const IconDoc = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 3.5h7.5L18 8v12.5H6z" />
    <path d="M13.5 3.5V8H18M9 12.5h6M9 16h4" />
  </svg>
);

export const IconPlay = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 5.5l10 6.5-10 6.5z" />
  </svg>
);

export const IconPause = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9.5 5.5v13M14.5 5.5v13" />
  </svg>
);

export const IconGrid = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
  </svg>
);
