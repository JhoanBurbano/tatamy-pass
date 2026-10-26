/**
 * Preferencias de pantalla del operador (§8): modo guantes (botones aún más
 * grandes) y alto contraste (exteriores). Persisten en localStorage.
 */
export interface UiPrefs {
  gloves: boolean;
  contrast: boolean;
}

const KEY = 'tp.prefs';
export const defaultPrefs: UiPrefs = { gloves: false, contrast: false };

export function loadPrefs(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): UiPrefs {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultPrefs;
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return { gloves: !!p.gloves, contrast: !!p.contrast };
  } catch {
    return defaultPrefs;
  }
}

export function savePrefs(prefs: UiPrefs, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ }
}

/** Clases CSS del contenedor raíz según preferencias. */
export function prefsClassName(prefs: UiPrefs): string {
  return [prefs.gloves ? 'gloves' : '', prefs.contrast ? 'contrast' : ''].filter(Boolean).join(' ');
}
