// Settings types and management

export interface AppSettings {
  sessionGapMinutes: number;
  jpegQuality: number;
  maxResolution: number;
  maxPhotos: number;
  maxStorageMB: number;
  defaultCamera: 'environment' | 'user';
  autoRestartCamera: boolean;
  confirmDelete: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sessionGapMinutes: 10,
  jpegQuality: 80,
  maxResolution: 1920,
  maxPhotos: 1000,
  maxStorageMB: 500,
  defaultCamera: 'environment',
  autoRestartCamera: true,
  confirmDelete: false,
};

const SETTINGS_KEY = 'appSettings';

let currentSettings: AppSettings = { ...DEFAULT_SETTINGS };

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

export function saveSettings(settings: AppSettings): boolean {
  try {
    currentSettings = { ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

export function getSettings(): AppSettings {
  return currentSettings;
}

export function resetSettings(): AppSettings {
  currentSettings = { ...DEFAULT_SETTINGS };
  localStorage.removeItem(SETTINGS_KEY);
  return currentSettings;
}

// Computed settings getters
export function getSessionGapMs(): number {
  return currentSettings.sessionGapMinutes * 60 * 1000;
}

export function getJpegQuality(): number {
  return currentSettings.jpegQuality / 100;
}

export function getMaxWidth(): number {
  return currentSettings.maxResolution;
}

export function getMaxHeight(): number {
  return Math.round(currentSettings.maxResolution * 9 / 16);
}

export function getMaxPhotos(): number {
  return currentSettings.maxPhotos;
}

export function getMaxBytes(): number {
  return currentSettings.maxStorageMB * 1024 * 1024;
}
