/**
 * Settings Screen Component
 *
 * Provides a comprehensive settings screen with:
 * - Device management and information
 * - Sync controls and status
 * - Recovery code access
 * - Session settings
 * - Account management (lock, logout)
 *
 * @module components/SettingsScreen
 *
 * @example
 * ```tsx
 * import { SettingsScreen } from '@/components/SettingsScreen';
 *
 * function SettingsPage() {
 *   return (
 *     <SettingsScreen
 *       onClose={() => navigate('/')}
 *       onShowRecovery={() => setShowRecoveryModal(true)}
 *     />
 *   );
 * }
 * ```
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ChangeEvent,
} from 'react';
import { useAuth, AuthState } from '../context/AuthContext';
import {
  useSyncStatusUI,
  useSyncState,
  SyncStatus as SyncStatusEnum,
} from '../sync/hooks';
import { SyncStatus } from './SyncStatus';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for SettingsScreen component
 */
export interface SettingsScreenProps {
  /** Callback when settings screen is closed */
  onClose?: () => void;
  /** Callback to show recovery QR code */
  onShowRecovery?: () => void;
  /** Callback to add a new device */
  onAddDevice?: () => void;
  /** Custom class name for styling */
  className?: string;
  /** App name for display (default: 'TrichoApp') */
  appName?: string;
}

/**
 * Device information structure
 */
interface DeviceInfo {
  name: string;
  type: 'phone' | 'tablet' | 'desktop' | 'unknown';
  browser: string;
  os: string;
  isCurrent: boolean;
  lastActive: number;
  id: string;
}

/**
 * App settings stored locally
 */
interface AppSettings {
  sessionGapMinutes: number;
  jpegQuality: number;
  maxResolution: number;
  maxPhotos: number;
  maxStorageMB: number;
  defaultCamera: 'environment' | 'user';
  autoRestartCamera: boolean;
  confirmDelete: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SETTINGS: AppSettings = {
  sessionGapMinutes: 10,
  jpegQuality: 80,
  maxResolution: 1920,
  maxPhotos: 1000,
  maxStorageMB: 500,
  defaultCamera: 'environment',
  autoRestartCamera: true,
  confirmDelete: false,
};

const SETTINGS_STORAGE_KEY = 'tricho:app_settings';

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Settings icon SVG
 */
function SettingsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * Shield/Security icon SVG
 */
function ShieldIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--shield"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/**
 * Device/smartphone icon SVG
 */
function DeviceIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--device"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

/**
 * Cloud/Sync icon SVG
 */
function CloudIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--cloud"
      aria-hidden="true"
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

/**
 * Image/photo icon SVG
 */
function ImageIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--image"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

/**
 * Camera icon SVG
 */
function CameraIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--camera"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/**
 * Lock icon SVG
 */
function LockIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--lock"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * Log out icon SVG
 */
function LogOutIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--logout"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/**
 * User/Profile icon SVG
 */
function UserIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--user"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Plus icon SVG
 */
function PlusIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--plus"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * Chevron right icon SVG
 */
function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-chevron"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/**
 * Back/close icon SVG
 */
function BackIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="settings-icon settings-icon--back"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/**
 * Toggle switch component
 */
function Toggle({
  active,
  onChange,
  id,
  disabled = false,
}: {
  active: boolean;
  onChange: (value: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!active);
    }
  }, [active, onChange, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
        e.preventDefault();
        onChange(!active);
      }
    },
    [active, onChange, disabled]
  );

  return (
    <div
      id={id}
      className={`settings-toggle ${active ? 'settings-toggle--active' : ''} ${disabled ? 'settings-toggle--disabled' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="switch"
      aria-checked={active}
      tabIndex={disabled ? -1 : 0}
    >
      <div className="settings-toggle-knob" />
    </div>
  );
}

/**
 * Settings section component
 */
function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        {icon && <span className="settings-section-icon">{icon}</span>}
        <h3 className="settings-section-title">{title}</h3>
      </div>
      <div className="settings-section-content">{children}</div>
    </div>
  );
}

/**
 * Settings row component
 */
function SettingsRow({
  label,
  hint,
  children,
  onClick,
  showChevron = false,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
}) {
  const isClickable = !!onClick;

  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && onClick) {
        e.preventDefault();
        onClick();
      }
    },
    [onClick]
  );

  return (
    <div
      className={`settings-row ${isClickable ? 'settings-row--clickable' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="settings-label">
        <div className="settings-label-text">{label}</div>
        {hint && <div className="settings-label-hint">{hint}</div>}
      </div>
      {children && <div className="settings-control">{children}</div>}
      {showChevron && <ChevronRightIcon size={16} />}
    </div>
  );
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Load settings from localStorage
 */
function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }

  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to localStorage
 */
function saveSettings(settings: AppSettings): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }
}

/**
 * Get current device information
 */
function getCurrentDeviceInfo(): DeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  // Detect device type
  let type: DeviceInfo['type'] = 'unknown';
  if (/iPad|tablet/i.test(ua)) {
    type = 'tablet';
  } else if (/Mobile|iPhone|Android/i.test(ua)) {
    type = 'phone';
  } else if (/Windows|Macintosh|Linux/i.test(ua)) {
    type = 'desktop';
  }

  // Detect browser
  let browser = 'Unknown Browser';
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = 'Chrome';
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = 'Safari';
  } else if (/Firefox/i.test(ua)) {
    browser = 'Firefox';
  } else if (/Edg/i.test(ua)) {
    browser = 'Edge';
  }

  // Detect OS
  let os = 'Unknown OS';
  if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS X|macOS/i.test(ua)) {
    os = 'macOS';
  } else if (/iPhone|iPad/i.test(ua)) {
    os = 'iOS';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  // Generate device name
  const name = `${os} ${browser}`;

  return {
    name,
    type,
    browser,
    os,
    isCurrent: true,
    lastActive: Date.now(),
    id: 'current-device',
  };
}

/**
 * Format storage size for display
 */
function formatStorageSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Settings Screen Component
 *
 * Provides comprehensive settings management including:
 * - Device information and management
 * - Sync status and controls
 * - Recovery code access
 * - Image quality and storage settings
 * - Camera preferences
 * - Account actions (lock, logout)
 */
export function SettingsScreen({
  onClose,
  onShowRecovery,
  onAddDevice,
  className = '',
  appName = 'TrichoApp',
}: SettingsScreenProps) {
  // ========================================================================
  // State
  // ========================================================================

  const auth = useAuth();
  const { user, lock, logout, prfSupported, unlockMethod } = auth;

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [deviceInfo] = useState<DeviceInfo>(() => getCurrentDeviceInfo());
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);

  // Load storage estimate
  useEffect(() => {
    async function loadStorageEstimate() {
      if (typeof navigator !== 'undefined' && 'storage' in navigator) {
        try {
          const estimate = await navigator.storage.estimate();
          setStorageUsed(estimate.usage ?? null);
        } catch {
          // Storage API not available
        }
      }
    }

    loadStorageEstimate();
  }, []);

  // ========================================================================
  // Settings Handlers
  // ========================================================================

  const handleSettingChange = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => {
        const updated = { ...prev, [key]: value };
        saveSettings(updated);
        return updated;
      });
    },
    []
  );

  const handleResetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings({ ...DEFAULT_SETTINGS });
  }, []);

  // ========================================================================
  // Account Handlers
  // ========================================================================

  const handleLock = useCallback(async () => {
    await lock();
    onClose?.();
  }, [lock, onClose]);

  const handleLogout = useCallback(async () => {
    await logout();
    onClose?.();
  }, [logout, onClose]);

  const handleLogoutClick = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  const handleCancelLogout = useCallback(() => {
    setShowLogoutConfirm(false);
  }, []);

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = ['settings-screen', className].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      {/* Header */}
      <header className="settings-header">
        {onClose && (
          <button
            type="button"
            className="settings-back-button"
            onClick={onClose}
            aria-label="Close settings"
          >
            <BackIcon size={24} />
          </button>
        )}
        <h1 className="settings-title">Settings</h1>
        <div className="settings-header-spacer" />
      </header>

      {/* Content */}
      <div className="settings-content">
        {/* Account Section */}
        <SettingsSection title="Account" icon={<UserIcon size={20} />}>
          <SettingsRow label="Email" hint={user?.username}>
            <span className="settings-value">{user?.username || 'Unknown'}</span>
          </SettingsRow>
          <SettingsRow
            label="Security Method"
            hint={prfSupported ? 'Using advanced passkey security' : 'Using recovery secret'}
          >
            <span className="settings-value">
              {unlockMethod === 'prf' ? 'Passkey + PRF' : 'Passkey'}
            </span>
          </SettingsRow>
        </SettingsSection>

        {/* Device Management Section */}
        <SettingsSection title="This Device" icon={<DeviceIcon size={20} />}>
          <SettingsRow label="Device Name">
            <span className="settings-value">{deviceInfo.name}</span>
          </SettingsRow>
          <SettingsRow label="Type">
            <span className="settings-value">
              {deviceInfo.type.charAt(0).toUpperCase() + deviceInfo.type.slice(1)}
            </span>
          </SettingsRow>
          {storageUsed !== null && (
            <SettingsRow label="Storage Used">
              <span className="settings-value">{formatStorageSize(storageUsed)}</span>
            </SettingsRow>
          )}
          {onAddDevice && (
            <SettingsRow
              label="Add Another Device"
              hint="Scan QR to link a new device"
              onClick={onAddDevice}
              showChevron
            >
              <PlusIcon size={18} />
            </SettingsRow>
          )}
        </SettingsSection>

        {/* Sync Section */}
        <SettingsSection title="Sync" icon={<CloudIcon size={20} />}>
          <div className="settings-sync-status">
            <SyncStatus variant="full" showDetails showSyncButton showErrors />
          </div>
        </SettingsSection>

        {/* Recovery Section */}
        <SettingsSection title="Recovery" icon={<ShieldIcon size={20} />}>
          {onShowRecovery && (
            <SettingsRow
              label="View Recovery Code"
              hint="Use this to recover your account on a new device"
              onClick={onShowRecovery}
              showChevron
            />
          )}
          <div className="settings-recovery-note">
            <ShieldIcon size={16} />
            <span>
              Your recovery code is the only way to recover your account if you lose
              access to your passkey. Keep it in a safe place.
            </span>
          </div>
        </SettingsSection>

        {/* Session Settings */}
        <SettingsSection title="Sessions" icon={<SettingsIcon size={20} />}>
          <SettingsRow
            label="Session Gap"
            hint="Pause between captures for new session"
          >
            <div className="settings-input-group">
              <input
                type="number"
                className="settings-input"
                min={1}
                max={60}
                value={settings.sessionGapMinutes}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleSettingChange('sessionGapMinutes', parseInt(e.target.value, 10) || 10)
                }
                aria-label="Session gap in minutes"
              />
              <span className="settings-unit">min</span>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* Image Quality Settings */}
        <SettingsSection title="Image Quality" icon={<ImageIcon size={20} />}>
          <SettingsRow label="JPEG Quality" hint="Higher = better quality, larger files">
            <div className="settings-input-group">
              <input
                type="number"
                className="settings-input"
                min={50}
                max={100}
                step={5}
                value={settings.jpegQuality}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleSettingChange('jpegQuality', parseInt(e.target.value, 10) || 80)
                }
                aria-label="JPEG quality percentage"
              />
              <span className="settings-unit">%</span>
            </div>
          </SettingsRow>
          <SettingsRow label="Max Resolution" hint="Larger images use more storage">
            <select
              className="settings-select"
              value={settings.maxResolution}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                handleSettingChange('maxResolution', parseInt(e.target.value, 10))
              }
              aria-label="Maximum image resolution"
            >
              <option value={1280}>HD (1280px)</option>
              <option value={1920}>Full HD (1920px)</option>
              <option value={2560}>QHD (2560px)</option>
              <option value={3840}>4K (3840px)</option>
            </select>
          </SettingsRow>
        </SettingsSection>

        {/* Storage Settings */}
        <SettingsSection title="Storage" icon={<CloudIcon size={20} />}>
          <SettingsRow label="Max Photos" hint="Older photos will be auto-deleted">
            <input
              type="number"
              className="settings-input"
              min={100}
              max={5000}
              step={100}
              value={settings.maxPhotos}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleSettingChange('maxPhotos', parseInt(e.target.value, 10) || 1000)
              }
              aria-label="Maximum number of photos"
            />
          </SettingsRow>
          <SettingsRow label="Max Storage" hint="Limit for automatic cleanup">
            <div className="settings-input-group">
              <input
                type="number"
                className="settings-input"
                min={100}
                max={2000}
                step={50}
                value={settings.maxStorageMB}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleSettingChange('maxStorageMB', parseInt(e.target.value, 10) || 500)
                }
                aria-label="Maximum storage in megabytes"
              />
              <span className="settings-unit">MB</span>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* Camera Settings */}
        <SettingsSection title="Camera" icon={<CameraIcon size={20} />}>
          <SettingsRow label="Default Camera" hint="Which camera opens on start">
            <select
              className="settings-select"
              value={settings.defaultCamera}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                handleSettingChange('defaultCamera', e.target.value as 'environment' | 'user')
              }
              aria-label="Default camera selection"
            >
              <option value="environment">Back Camera</option>
              <option value="user">Front Camera</option>
            </select>
          </SettingsRow>
          <SettingsRow label="Auto-restart Camera" hint="Resume camera when returning to app">
            <Toggle
              id="setting-auto-restart"
              active={settings.autoRestartCamera}
              onChange={(value) => handleSettingChange('autoRestartCamera', value)}
            />
          </SettingsRow>
        </SettingsSection>

        {/* Other Settings */}
        <SettingsSection title="Other" icon={<SettingsIcon size={20} />}>
          <SettingsRow label="Confirm Delete" hint="Ask before deleting photos">
            <Toggle
              id="setting-confirm-delete"
              active={settings.confirmDelete}
              onChange={(value) => handleSettingChange('confirmDelete', value)}
            />
          </SettingsRow>
        </SettingsSection>

        {/* Account Actions */}
        <SettingsSection title="Session" icon={<LockIcon size={20} />}>
          <SettingsRow
            label="Lock App"
            hint="Require passkey to unlock"
            onClick={handleLock}
            showChevron
          >
            <LockIcon size={18} />
          </SettingsRow>
        </SettingsSection>

        {/* Danger Zone */}
        <div className="settings-danger-zone">
          <h3 className="settings-danger-title">Danger Zone</h3>
          <button
            type="button"
            className="settings-button settings-button--danger"
            onClick={handleLogoutClick}
          >
            <LogOutIcon size={18} />
            <span>Log Out & Clear Data</span>
          </button>
          <p className="settings-danger-hint">
            This will delete all local data and require account recovery.
          </p>
        </div>

        {/* Reset Settings Button */}
        <div className="settings-footer">
          <button
            type="button"
            className="settings-button settings-button--ghost"
            onClick={handleResetSettings}
          >
            Reset to Defaults
          </button>
          <p className="settings-version">
            {appName} v1.0.0
          </p>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <div className="settings-modal-header">
              <h2 className="settings-modal-title">Log Out?</h2>
            </div>
            <div className="settings-modal-body">
              <p>
                This will <strong>delete all local data</strong> including photos,
                customer information, and encryption keys.
              </p>
              <p>
                To restore your account, you will need your <strong>recovery code</strong>.
              </p>
            </div>
            <div className="settings-modal-footer">
              <button
                type="button"
                className="settings-button settings-button--ghost"
                onClick={handleCancelLogout}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-button settings-button--danger"
                onClick={handleLogout}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Compact settings button for use in headers.
 *
 * @example
 * ```tsx
 * <Header>
 *   <SettingsButton onClick={() => setShowSettings(true)} />
 * </Header>
 * ```
 */
export function SettingsButton({
  onClick,
  className = '',
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`settings-button-icon ${className}`}
      onClick={onClick}
      aria-label="Open settings"
    >
      <SettingsIcon size={24} />
    </button>
  );
}

/**
 * Settings link row for embedding in other screens.
 *
 * @example
 * ```tsx
 * <SettingsLink onClick={() => navigate('/settings')} />
 * ```
 */
export function SettingsLink({
  onClick,
  className = '',
}: {
  onClick?: () => void;
  className?: string;
}) {
  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  return (
    <button
      type="button"
      className={`settings-link ${className}`}
      onClick={handleClick}
    >
      <SettingsIcon size={20} />
      <span>Settings</span>
      <ChevronRightIcon size={16} />
    </button>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default SettingsScreen;
