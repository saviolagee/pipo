import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useUi } from '../store/ui';
import { Recorder, transcribe, whisperListeners } from './recorder';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

/** Gravação + transcrição local. `onText` recebe o texto transcrito. */
export function useVoice(onText: (text: string) => void): {
  state: VoiceState;
  error: string | null;
  modelProgress: number | null;
  level: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
} {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const rec = useRef<Recorder | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const l = (m: { type: string; percent?: number }): void => {
      if (m.type === 'progress' && typeof m.percent === 'number') setModelProgress(m.percent);
      if (m.type === 'ready') setModelProgress(null);
    };
    whisperListeners.push(l);
    return () => {
      whisperListeners.splice(whisperListeners.indexOf(l), 1);
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setLevel(rec.current?.readLevel() ?? 0), 80);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    useUi.setState({ voiceRequested: state === 'recording' });
    useUi.getState().pin('voice', state === 'recording' || state === 'transcribing');
  }, [state]);

  const start = useCallback(async () => {
    if (rec.current) return;
    setError(null);
    try {
      // Microfone: pedido só no primeiro uso (seção 13).
      if (!(await api.invoke('app:askMic'))) throw new Error('Sem permissão de microfone.');
      const r = new Recorder();
      await r.start();
      rec.current = r;
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setState('transcribing');
    try {
      const audio = await r.stop();
      if (audio.length < 16000 * 0.4) {
        setState('idle');
        return;
      }
      const text = await transcribe(audio);
      setState('idle');
      if (text) onTextRef.current(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  const toggle = useCallback(async () => (rec.current ? stop() : start()), [start, stop]);

  useEffect(() => () => rec.current?.cancel(), []);

  return { state, error, modelProgress, level, start, stop, toggle };
}
