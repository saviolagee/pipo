import { useEffect, useRef, useState } from 'react';

export function App(): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => window.pipo.on('ui:toggle', () => setExpanded((v) => !v)), []);

  return (
    <div className="flex h-full w-full justify-center">
      <div
        ref={ref}
        onMouseEnter={() => void window.pipo.invoke('window:setInteractive', true)}
        onMouseLeave={() => void window.pipo.invoke('window:setInteractive', false)}
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: expanded ? 720 : 340,
          height: expanded ? 220 : 32,
          background: '#000',
          borderRadius: expanded ? '0 0 24px 24px' : '0 0 16px 16px',
        }}
      />
    </div>
  );
}
