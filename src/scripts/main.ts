// Main application initialization

import {
  loadSettings,
  saveSettings,
  getSettings,
  resetSettings,
  type AppSettings,
} from './settings';

import {
  initCameraElements,
  initCamera,
  stopCamera,
  switchCamera,
  selectCamera,
  capturePhoto,
  getPreferredCameraId,
  isPermissionGranted,
  listVideoDevices,
  markPermissionGranted,
  clearPermissionStatus,
} from './camera';

import {
  initGalleryElements,
  renderGallery,
  cleanupOlderThanMonths,
  enforceLimits,
  updatePhotoHint,
  showGallery,
  hideGallery,
} from './gallery';

import {
  initPwaElements,
  setupInstallHandlers,
  updateOnlineStatus,
  updateModeStatus,
} from './pwa';

export function initApp(basePath: string) {
  // Load settings first
  loadSettings();

  // Get DOM elements
  const onlineDot = document.getElementById('onlineDot')!;
  const onlineStatus = document.getElementById('onlineStatus')!;
  const modeLabel = document.getElementById('modeLabel')!;
  const installButton = document.getElementById('installButton') as HTMLButtonElement;
  const installHint = document.getElementById('installHint')!;
  const video = document.getElementById('video') as HTMLVideoElement;
  const cameraSelect = document.getElementById('cameraSelect') as HTMLSelectElement;
  const captureButton = document.getElementById('captureButton')!;
  const galleryButton = document.getElementById('galleryButton')!;
  const closeGalleryButton = document.getElementById('closeGalleryButton')!;
  const galleryCard = document.getElementById('galleryCard')!;
  const galleryGrid = document.getElementById('galleryGrid')!;
  const gallerySummary = document.getElementById('gallerySummary')!;
  const cameraLabel = document.getElementById('cameraLabel')!;
  const cameraDot = document.getElementById('cameraDot')!;
  const switchCameraButton = document.getElementById('switchCameraButton')!;
  const errorBox = document.getElementById('errorBox')!;
  const errorText = document.getElementById('errorText')!;
  const canvas = document.getElementById('captureCanvas') as HTMLCanvasElement;
  const monthsInput = document.getElementById('monthsInput') as HTMLInputElement;
  const cleanupButton = document.getElementById('cleanupButton')!;
  const cleanupResult = document.getElementById('cleanupResult')!;
  const sessionList = document.getElementById('sessionList')!;
  const photoCountHint = document.getElementById('photoCountHint')!;
  const cameraFooterText = document.getElementById('cameraFooterText')!;

  // Settings modal elements
  const settingsButton = document.getElementById('settingsButton')!;
  const settingsModal = document.getElementById('settingsModal')!;
  const settingsCloseBtn = document.getElementById('settingsCloseBtn')!;
  const settingsSaveBtn = document.getElementById('settingsSaveBtn')!;
  const settingsResetBtn = document.getElementById('settingsResetBtn')!;
  const settingSessionGap = document.getElementById('settingSessionGap') as HTMLInputElement;
  const settingJpegQuality = document.getElementById('settingJpegQuality') as HTMLInputElement;
  const settingResolution = document.getElementById('settingResolution') as HTMLSelectElement;
  const settingMaxPhotos = document.getElementById('settingMaxPhotos') as HTMLInputElement;
  const settingMaxStorage = document.getElementById('settingMaxStorage') as HTMLInputElement;
  const settingDefaultCamera = document.getElementById('settingDefaultCamera') as HTMLSelectElement;
  const settingAutoRestart = document.getElementById('settingAutoRestart')!;
  const settingConfirmDelete = document.getElementById('settingConfirmDelete')!;

  // Initialize modules with DOM elements
  initCameraElements({
    video,
    canvas,
    cameraSelect,
    cameraLabel,
    cameraDot,
    errorBox,
    errorText,
  });

  initGalleryElements({
    galleryCard,
    galleryGrid,
    gallerySummary,
    sessionList,
    photoCountHint,
    cleanupResult,
    monthsInput,
  });

  initPwaElements({
    installButton,
    installHint,
  });

  // Settings modal functions
  function populateSettingsForm() {
    const s = getSettings();
    settingSessionGap.value = String(s.sessionGapMinutes);
    settingJpegQuality.value = String(s.jpegQuality);
    settingResolution.value = String(s.maxResolution);
    settingMaxPhotos.value = String(s.maxPhotos);
    settingMaxStorage.value = String(s.maxStorageMB);
    settingDefaultCamera.value = s.defaultCamera;

    if (s.autoRestartCamera) {
      settingAutoRestart.classList.add('active');
    } else {
      settingAutoRestart.classList.remove('active');
    }

    if (s.confirmDelete) {
      settingConfirmDelete.classList.add('active');
    } else {
      settingConfirmDelete.classList.remove('active');
    }
  }

  function getSettingsFromForm(): AppSettings {
    return {
      sessionGapMinutes: Math.max(1, Math.min(60, parseInt(settingSessionGap.value, 10) || 10)),
      jpegQuality: Math.max(50, Math.min(100, parseInt(settingJpegQuality.value, 10) || 80)),
      maxResolution: parseInt(settingResolution.value, 10) || 1920,
      maxPhotos: Math.max(100, Math.min(5000, parseInt(settingMaxPhotos.value, 10) || 1000)),
      maxStorageMB: Math.max(100, Math.min(2000, parseInt(settingMaxStorage.value, 10) || 500)),
      defaultCamera: (settingDefaultCamera.value as 'environment' | 'user') || 'environment',
      autoRestartCamera: settingAutoRestart.classList.contains('active'),
      confirmDelete: settingConfirmDelete.classList.contains('active'),
    };
  }

  function updateCameraFooterHint() {
    const s = getSettings();
    const resLabel =
      s.maxResolution >= 3840
        ? '4K'
        : s.maxResolution >= 2560
        ? 'QHD'
        : s.maxResolution >= 1920
        ? 'Full HD'
        : 'HD';
    cameraFooterText.textContent = resLabel + ', JPEG ' + s.jpegQuality + ' %, ukládání lokálně.';
  }

  function openSettingsModal() {
    populateSettingsForm();
    settingsModal.classList.add('visible');
  }

  function closeSettingsModal() {
    settingsModal.classList.remove('visible');
  }

  function handleSettingsSave() {
    const newSettings = getSettingsFromForm();
    if (saveSettings(newSettings)) {
      updateCameraFooterHint();
      closeSettingsModal();
    }
  }

  function handleSettingsReset() {
    resetSettings();
    populateSettingsForm();
  }

  // Setup event listeners
  function setupListeners() {
    window.addEventListener('online', () => updateOnlineStatus(onlineDot, onlineStatus));
    window.addEventListener('offline', () => updateOnlineStatus(onlineDot, onlineStatus));

    // Settings modal listeners
    settingsButton.addEventListener('click', openSettingsModal);
    settingsCloseBtn.addEventListener('click', closeSettingsModal);
    settingsSaveBtn.addEventListener('click', handleSettingsSave);
    settingsResetBtn.addEventListener('click', handleSettingsReset);

    // Close modal on overlay click
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    });

    // Toggle switches
    settingAutoRestart.addEventListener('click', () => {
      settingAutoRestart.classList.toggle('active');
    });
    settingConfirmDelete.addEventListener('click', () => {
      settingConfirmDelete.classList.toggle('active');
    });

    // Camera controls
    cameraSelect.addEventListener('change', () => {
      const id = cameraSelect.value;
      if (id) {
        selectCamera(id);
      }
    });

    switchCameraButton.addEventListener('click', switchCamera);

    captureButton.addEventListener('click', async () => {
      const success = await capturePhoto();
      if (success) {
        await enforceLimits();
        galleryCard.hidden = false;
        await renderGallery();
      }
    });

    // Gallery controls
    galleryButton.addEventListener('click', showGallery);
    closeGalleryButton.addEventListener('click', hideGallery);

    if (cleanupButton) {
      cleanupButton.addEventListener('click', cleanupOlderThanMonths);
    }

    // Visibility change handler
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else if (document.visibilityState === 'visible') {
        const settings = getSettings();
        if (settings.autoRestartCamera && isPermissionGranted()) {
          const preferred = getPreferredCameraId();
          initCamera(preferred || null);
        }
      }
    });

    // Monitor permission changes
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((permissionStatus) => {
          permissionStatus.onchange = () => {
            if (permissionStatus.state === 'granted') {
              markPermissionGranted();
              const preferred = getPreferredCameraId();
              initCamera(preferred || null);
            } else if (permissionStatus.state === 'denied') {
              clearPermissionStatus();
              stopCamera();
            }
          };
        })
        .catch(() => {
          // Permissions API not supported for camera (iOS Safari)
        });
    }
  }

  // Initialize
  updateCameraFooterHint();
  updateOnlineStatus(onlineDot, onlineStatus);
  updateModeStatus(modeLabel);
  setupInstallHandlers(basePath);
  setupListeners();

  const preferred = getPreferredCameraId();
  initCamera(preferred || null);
  listVideoDevices(preferred || null).catch(() => {});
  updatePhotoHint().catch(() => {});
}
