/**
 * Contrato entre el proceso principal y la ventana (IPC). Lo importan main,
 * preload y renderer; solo tipos, sin código.
 */

export type HostMode = 'primary' | 'standby';

export interface Settings {
  version: 1;
  setupDone: boolean;
  /** Nombre de la sede (p. ej. "Coliseo La Estancia"). Solo informativo. */
  siteName: string;
  mode: HostMode;
  primaryUrl: string;
  replicaKey: string;
  port: number;
  httpsEnabled: boolean;
  httpsPort: number;
  cloudUrl: string;
  cloudKey: string;
  cloudIntervalMinutes: number;
  /** Segundo destino de copias (USB). Vacío = ninguno. */
  backupsDir2: string;
  launchAtLogin: boolean;
  /** Ruta del event.config.json. Vacío = el que vive en la carpeta de datos. */
  eventConfigPath: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  zone: string;
  role: string;
  lastSeenAt: string | null;
  pending: number;
  online: boolean;
  disabled: boolean;
}

export interface DesktopState {
  version: string;
  platform: NodeJS.Platform;
  setupDone: boolean;
  running: boolean;
  starting: boolean;
  /** Error de arranque del host, si lo hubo. */
  hostError: string | null;
  mode: HostMode;
  port: number;
  lanIps: string[];
  /** URLs que se muestran y van en el QR (https si Caddy corre, si no http). */
  urls: string[];
  https: { enabled: boolean; running: boolean; port: number; rootCertAvailable: boolean; error: string | null; binaryFound: boolean };
  event: { id: string; name: string; startDate: string; endDate: string; configPath: string; zones: { code: string; name: string }[] } | null;
  devices: DeviceSummary[];
  pendingTotal: number;
  /** Equipos (scanners y paneles) conectados a Tatami Radio. */
  radioConnected: number;
  counts: { credentials: number; scans: number; persons: number };
  backups: { lastBackupAt: string | null; dir: string; dir2: string | null; dir2Available: boolean; lastBackup2At: string | null; lastBackup2Error: string | null; count: number };
  cloud: { configured: boolean; url: string | null; lastCloudSyncAt: string | null; intervalMinutes: number; message: string; online: boolean | null };
  replica: { primaryUrl: string | null; lagSeconds: number | null; online: boolean | null; message: string };
  passphraseSet: boolean;
  passphraseStorage: 'safeStorage' | 'plain' | 'none';
  dataDir: string;
  siteName: string;
}

export interface EnrollInput { name: string; zone: string; role: 'CONTROL' | 'SUPERVISOR' }
export interface EnrollResult { token: string; expiresAt: string; hostUrl: string; qrText: string; qrDataUrl: string }

export interface SetupInput {
  siteName: string;
  mode: HostMode;
  primaryUrl: string;
  replicaKey: string;
  passphrase: string;
  /** 'file' usa eventConfigPath; 'demo' crea el evento de prueba con seed. */
  eventSource: 'file' | 'demo';
  eventConfigPath: string;
  backupsDir2: string;
}

export interface ActionResult { ok: boolean; message: string }

export interface FieldError { path: string; message: string }

export interface TpApi {
  getState(): Promise<DesktopState>;
  onState(cb: (s: DesktopState) => void): () => void;
  getLogs(): Promise<string[]>;
  onLog(cb: (line: string) => void): () => void;
  openPanel(): Promise<void>;
  openPath(path: string): Promise<void>;
  createEnrollment(input: EnrollInput): Promise<EnrollResult | { error: string }>;
  backupNow(): Promise<ActionResult>;
  backupToUsb(): Promise<ActionResult>;
  cloudPullNow(): Promise<ActionResult>;
  promote(step: 1 | 2, text: string): Promise<ActionResult & { step?: number }>;
  changeEventFile(): Promise<ActionResult>;
  exportRootCert(): Promise<ActionResult>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<{ ok: boolean; errors: FieldError[]; restarted: boolean }>;
  setPassphrase(passphrase: string): Promise<ActionResult>;
  chooseFolder(title: string): Promise<string | null>;
  chooseFile(title: string): Promise<string | null>;
  runSetup(input: SetupInput): Promise<{ ok: boolean; errors: FieldError[]; message?: string }>;
  restartHost(): Promise<ActionResult>;
  quit(): Promise<void>;
}
