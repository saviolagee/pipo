// Testes de captura (em desenvolvimento, ou no app empacotado com PIPO_E2E=1): com PIPO_CAPTURE_OFFSCREEN=1 as janelas abrem fora da
// tela e nunca pegam o foco, para o teste não aparecer na frente de quem está usando o computador.
import { app } from 'electron';

export const OFFSCREEN = (!app.isPackaged || process.env.PIPO_E2E === '1') && process.env.PIPO_CAPTURE_OFFSCREEN === '1';
/** Bem longe de qualquer monitor. */
export const OFF_X = -12000;
