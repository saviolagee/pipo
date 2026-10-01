// Ícones em SVG inline (sem dependências), traço 1.8 e cantos arredondados como na referência.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props,
});

export const IconHome = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <path d="M10.6 3.5a2.2 2.2 0 0 1 2.8 0l6.5 5.4c.5.4.8 1 .8 1.7v8.2c0 1.2-1 2.2-2.2 2.2h-3.3a.9.9 0 0 1-.9-.9v-4.4a1.3 1.3 0 0 0-1.3-1.3h-2a1.3 1.3 0 0 0-1.3 1.3v4.4a.9.9 0 0 1-.9.9H5.5a2.2 2.2 0 0 1-2.2-2.2v-8.2c0-.7.3-1.3.8-1.7z" />
  </svg>
);

export const IconChat = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <path d="M4 5.5C4 4.1 5.1 3 6.5 3h11C18.9 3 20 4.1 20 5.5v8c0 1.4-1.1 2.5-2.5 2.5H11l-4.4 3.6c-.6.5-1.6.1-1.6-.8V16h-.5A2.5 2.5 0 0 1 4 13.5z" />
  </svg>
);

export const IconPlus = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheckCircle = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19m4.2 6.3a1 1 0 0 0-1.4 0l-4 4-1.6-1.6a1 1 0 1 0-1.4 1.4l2.3 2.3a1 1 0 0 0 1.4 0l4.7-4.7a1 1 0 0 0 0-1.4" />
  </svg>
);

export const IconGear = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </svg>
);

export const IconSpeaker = ({ size = 16, muted = false, ...p }: P & { muted?: boolean }): React.JSX.Element => (
  <svg {...base(size, p)}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" />
    {muted ? (
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    ) : (
      <>
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        <path d="M18.3 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    )}
  </svg>
);

export const IconArrowUp = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} strokeWidth={2.4}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const IconArrowUpRight = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M8 16 16 8M9 8h7v7" />
  </svg>
);

export const IconMic = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)}>
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const IconCheck = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} strokeWidth={2.4}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconChevron = ({ size = 12, dir = 'right', ...p }: P & { dir?: 'right' | 'down' | 'left' | 'up' }): React.JSX.Element => {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return (
    <svg {...base(size, p)} strokeWidth={2.2} style={{ transform: `rotate(${rot}deg)`, ...p.style }}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
};

export const IconPlay = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.5-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8" />
  </svg>
);

export const IconPause = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </svg>
);

export const IconStop = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
  </svg>
);

export const IconFile = ({ size = 14, color = '#EF4444', ...p }: P & { color?: string }): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none">
    <path d="M6.5 2.5h7l5 5v12a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2" fill="#F4F4F5" />
    <path d="M13.5 2.5v3.5a1.5 1.5 0 0 0 1.5 1.5h3.5" fill="#D4D4D8" />
    <rect x="7" y="13" width="10" height="3.2" rx="1" fill={color} />
  </svg>
);

export const IconX = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconGrip = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    {[6, 12, 18].map((y) => (
      <g key={y}>
        <circle cx="9" cy={y} r="1.4" />
        <circle cx="15" cy={y} r="1.4" />
      </g>
    ))}
  </svg>
);

export const IconSpark = ({ size = 12, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)} stroke="none" fill="currentColor">
    <path d="M12 2.5c.4 4.6 2.9 7.1 7.5 7.5-4.6.4-7.1 2.9-7.5 7.5-.4-4.6-2.9-7.1-7.5-7.5 4.6-.4 7.1-2.9 7.5-7.5" />
  </svg>
);

/** Equipe: dois marshmallows lado a lado. */
export const IconTeam = ({ size = 16, ...p }: P): React.JSX.Element => (
  <svg {...base(size, p)}>
    <rect x="2.5" y="8" width="11" height="9" rx="3.2" />
    <rect x="12.5" y="5.5" width="9" height="7.5" rx="2.8" fill="currentColor" stroke="none" opacity="0.55" />
    <path d="M6.2 12.2v.6M9.8 12.2v.6" strokeWidth="2" />
  </svg>
);
