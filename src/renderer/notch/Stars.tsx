import { useMemo } from 'react';

/** Partículas tipo estrela que piscam lentamente no fundo idle [Ref 1]. Só CSS (opacity). */
export function Stars({ count = 46, seed = 7 }: { count?: number; seed?: number }): React.JSX.Element {
  const stars = useMemo(() => {
    let s = seed;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: count }, () => ({
      left: rnd() * 100,
      top: rnd() * 100,
      size: rnd() < 0.85 ? 1 : 1.6,
      delay: rnd() * 6,
      dur: 3 + rnd() * 4,
      base: 0.15 + rnd() * 0.35,
    }));
  }, [count, seed]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`@keyframes pipo-twinkle { 0%,100% { opacity: var(--b) } 50% { opacity: calc(var(--b) + 0.5) } }`}</style>
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={
            {
              left: `${st.left}%`,
              top: `${st.top}%`,
              width: st.size,
              height: st.size,
              '--b': st.base,
              opacity: st.base,
              animation: `pipo-twinkle ${st.dur}s ease-in-out ${st.delay}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
