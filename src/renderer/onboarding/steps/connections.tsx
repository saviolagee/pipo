import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { t } from '../../i18n/pt-BR';
import { api } from '../../lib/api';
import { useData } from '../../store/data';

const o = t.onboarding;

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}

export function GoogleStep(): React.JSX.Element {
  const google = useData((s) => s.integrations.find((i) => i.provider === 'google'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connect = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const info = await api.invoke('integrations:connect', 'google');
      useData.getState().set({ integrations: await api.invoke('integrations:list') });
      if (info.status !== 'connected') setErr(info.detail);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-[10px]">
      <p className="text-[12px] text-fg-2">{o.googleHint}</p>
      <div className="flex items-center gap-[10px]">
        <Button variant="primary" onClick={() => void connect()} disabled={busy || google?.status === 'connected'}>
          {google?.status === 'connected' ? `✓ ${t.integrations.connected}` : o.googleConnect}
        </Button>
        {google?.detail && google.status === 'connected' && <span className="text-[12px] text-fg-2">{google.detail}</span>}
      </div>
      {err && <p className="text-[12px] text-attention">{err}</p>}
    </div>
  );
}

export function ClaudeStep(): React.JSX.Element {
  const claude = useData((s) => s.claude);
  const [busy, setBusy] = useState(false);
  const check = async (): Promise<void> => {
    setBusy(true);
    useData.getState().set({ claude: { state: 'checking' } });
    try {
      useData.getState().set({ claude: await api.invoke('claude:status', true) });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="flex flex-col gap-[10px]">
      {claude.state === 'checking' && <p className="text-[13px] text-fg-2">{o.claudeChecking}</p>}
      {claude.state === 'ok' && (
        <p className="text-[13px] font-medium text-done">
          ✅ {o.claudeOk}
          {claude.version ? <span className="ml-2 text-fg-3">v{claude.version}</span> : null}
        </p>
      )}
      {claude.state === 'not_logged' && (
        <>
          <p className="text-[13px] font-medium text-attention">⚠️ {o.claudeNotLogged}</p>
          <p className="text-[12px] text-fg-2">{o.claudeNotLoggedHelp}</p>
          <div className="flex gap-[8px]">
            <Button onClick={() => void api.invoke('app:openTerminal')}>{o.openTerminal}</Button>
            <Button variant="primary" onClick={() => void check()} disabled={busy}>
              {t.common.retry}
            </Button>
          </div>
        </>
      )}
      {claude.state === 'not_installed' && (
        <>
          <p className="text-[13px] font-medium" style={{ color: '#F87171' }}>
            ❌ {o.claudeNotInstalled}
          </p>
          <p className="text-[12px] text-fg-2">{o.claudeWithout}</p>
          <div className="flex gap-[8px]">
            <Button onClick={() => void api.invoke('app:openExternal', 'https://code.claude.com/docs/en/setup')}>{o.claudeInstallLink}</Button>
            <Button variant="primary" onClick={() => void check()} disabled={busy}>
              {t.common.retry}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function PermissionsStep(): React.JSX.Element {
  const [perms, setPerms] = useState({ accessibility: false, screen: false });
  useEffect(() => {
    const load = (): void => void api.invoke('app:macPermissions').then(setPerms);
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);
  const row = (label: string, ok: boolean, pane: 'accessibility' | 'screen'): React.JSX.Element => (
    <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--bg-card-hover)' }}>
      <span className="text-[13px]">{label}</span>
      {ok ? (
        <span className="text-[12px] text-done">✓ {o.permGranted}</span>
      ) : (
        <Button size="sm" onClick={() => void api.invoke('app:openSystemPrefs', pane)}>
          {o.permOpen}
        </Button>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-[12px] text-fg-2">{o.permsHint}</p>
      {row(o.permAccessibility, perms.accessibility, 'accessibility')}
      {row(o.permScreen, perms.screen, 'screen')}
    </div>
  );
}
