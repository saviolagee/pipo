// Chamar por voz: com a opção ligada, o microfone fica ouvindo. Só falas curtas cercadas de silêncio
// vão para o modelo de voz local (o mesmo Whisper da captura por voz), que dá nota a "começa com Pipo?"
// e ao nome de cada Pipo. "Pipo" abre o chat do branco; "Pipo <nome>", o daquele Pipo. Nada é gravado
// nem sai do computador.
import { useEffect } from 'react';
import { decideWake, SpeechSegmenter, wakeFloor, wakePhrases, type WakeMatch } from '@shared/wake';
import { api } from '../lib/api';
import { openPipoChat } from '../screens/PipoDetail';
import { play } from '../sound/sfx';
import { useChat } from '../store/chat';
import { useData } from '../store/data';
import { usePipos } from '../store/pipos';
import { useUi } from '../store/ui';
import { preloadWhisper, scoreWake, transcribe } from './recorder';

/** O Whisper espera PCM mono a 16 kHz; o AudioContext do Chromium entrega nessa taxa quando pedido. */
const RATE = 16000;
/** Depois de abrir por voz, o notch fica aberto este tempo mesmo sem o mouse por cima. */
const HOLD_MS = 12_000;

/** Para calibrar: localStorage['pipo:wakeDebug'] = '1' mostra no console as notas e o que foi ouvido. */
const debugOn = (): boolean => {
  try {
    return localStorage.getItem('pipo:wakeDebug') === '1';
  } catch {
    return false;
  }
};

/** Liga o microfone e entrega cada fala curta. Devolve a função que desliga tudo. */
async function listen(onSpeech: (speech: Float32Array) => Promise<void>): Promise<() => void> {
  // Som cru: o supressor de ruído e o ganho automático do navegador comem o começo da palavra.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor é antigo, mas dispensa um arquivo de worklet à parte e serve para blocos de 64 ms.
  const node = ctx.createScriptProcessor(1024, 1, 1);
  // O nó só processa se estiver ligado à saída; o ganho zero garante que nada toca nas caixas.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const segmenter = new SpeechSegmenter({ sampleRate: ctx.sampleRate });
  let busy = false;
  let stopped = false;
  node.onaudioprocess = (e) => {
    const speech = segmenter.feed(e.inputBuffer.getChannelData(0));
    // Uma fala por vez: a que chega enquanto a anterior ainda é avaliada é descartada.
    if (!speech || busy || stopped) return;
    busy = true;
    void onSpeech(speech)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  return () => {
    stopped = true;
    node.onaudioprocess = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

async function evaluate(speech: Float32Array): Promise<WakeMatch | null> {
  const debug = debugOn();
  // A fala é transferida para o worker; a cópia só existe para mostrar o texto na depuração.
  const copy = debug ? speech.slice() : null;
  const names = usePipos.getState().list.map((p) => ({ id: p.id, phrases: wakePhrases(p.name) }));
  const level = useData.getState().settings?.voice?.sensitivity ?? 'normal';
  const { scores, ms } = await scoreWake(speech, names, wakeFloor(level));
  const match = decideWake(scores, level);
  if (copy) {
    const heard = await transcribe(copy).catch(() => '?');
    console.log(`[chamado] ${ms}ms pipo=${scores.wake.toFixed(2)} fim=${scores.end.toFixed(2)} nomes=${scores.names.map((n) => `${n.id}:${n.score.toFixed(2)}`).join(',') || '-'} -> ${match ? (match.kind === 'pipo' ? `pipo ${match.id}` : 'branco') : 'nada'} | texto livre: ${heard}`);
  }
  return match;
}

async function open(match: WakeMatch): Promise<void> {
  const ui = useUi.getState();
  ui.hold('wake', HOLD_MS);
  if (match.kind === 'pipo') {
    const p = usePipos.getState().list.find((x) => x.id === match.id);
    if (!p) return;
    await openPipoChat(p);
  } else {
    // Se o chat aberto é de um Pipo colorido, "Pipo" volta para o branco (sem cortar uma resposta no meio).
    const chat = useChat.getState();
    if (chat.owner && !chat.busy) chat.newConversation();
    ui.setTab('chat');
  }
  // Traz o notch à frente; só pega o teclado se você não estiver digitando em outro lugar.
  void api.invoke('window:show', { focusIfIdle: true });
  ui.react('happy', 1200);
  play('pop');
}

/** Mantém a escuta ligada enquanto a opção estiver ativa. Pausa em reunião, na gravação por voz e com o Pipo pausado. */
export function useWake(): void {
  const enabled = useData((s) => !!s.settings?.voice?.wake);
  const paused = useData((s) => !!s.settings?.paused);
  const inMeeting = useData((s) => s.inMeeting);
  const firstRun = useData((s) => s.firstRun);
  const recording = useUi((s) => s.voiceRequested);
  const active = enabled && !paused && !inMeeting && !recording && !firstRun;

  useEffect(() => {
    if (!active) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        if (!(await api.invoke('app:askMic'))) return;
        preloadWhisper();
        const off = await listen(async (speech) => {
          const match = await evaluate(speech);
          if (match && !cancelled) await open(match);
        });
        if (cancelled) off();
        else {
          stop = off;
          useUi.setState({ wakeListening: true });
        }
      } catch (err) {
        // Sem microfone ou sem permissão: a opção fica ligada, mas nada escuta.
        if (debugOn()) console.log('[chamado] sem microfone:', err);
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
      useUi.setState({ wakeListening: false });
    };
  }, [active]);
}
