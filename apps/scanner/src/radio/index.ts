/**
 * Tatami Radio en el navegador: arma `RadioClient` con las APIs reales
 * (WebSocket, RTCPeerConnection, getUserMedia con cancelación de eco y
 * supresión de ruido, elementos <audio> para cada par, voz y tonos).
 * Requiere HTTPS (o localhost): sin contexto seguro no hay micrófono.
 */
import { feedback } from '../feedback.js';
import { RadioClient, type RadioDeps } from './client.js';
import { speak } from './speech.js';

export { RadioClient } from './client.js';
export * from './state.js';

function attachRemote(stream: MediaStream, volume: number) {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.setAttribute('playsinline', '');
  el.srcObject = stream;
  el.volume = volume;
  el.style.display = 'none';
  el.dataset.tpRadio = 'remote';
  document.body.appendChild(el);
  void el.play().catch(() => undefined);
  return { setVolume: (v: number) => { el.volume = v; }, remove: () => { el.srcObject = null; el.remove(); } };
}

export function browserRadioDeps(): RadioDeps {
  return {
    WebSocket: globalThis.WebSocket,
    RTCPeerConnection: globalThis.RTCPeerConnection,
    getUserMedia: () => {
      if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Sin micrófono'));
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    },
    attachRemote,
    now: () => Date.now(),
    speak,
    tone: (kind) => feedback(kind),
    vibrate: (p) => { try { navigator.vibrate?.(p); } catch { /* nada */ } },
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t as number)
  };
}

/** Único cliente de radio del scanner. */
export const radioClient = new RadioClient(typeof window === 'undefined' ? ({} as RadioDeps) : browserRadioDeps());
