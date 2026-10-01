export function Kbd({ children, dark = false }: { children: React.ReactNode; dark?: boolean }): React.JSX.Element {
  return (
    <span
      className="mono inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[4px] px-1 text-[10px] leading-none"
      style={{
        border: `1px solid ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)'}`,
        color: dark ? 'rgba(0,0,0,0.6)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </span>
  );
}
