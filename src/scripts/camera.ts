// Camera management

import { getSettings, getJpegQuality, getMaxWidth, getMaxHeight } from './settings';
import { savePhotoBlob } from './storage';

const PREFERRED_CAMERA_KEY = 'preferredCameraDeviceId';
const PERMISSION_GRANTED_KEY = 'cameraPermissionGranted';

let currentStream: MediaStream | null = null;
let videoDevices: MediaDeviceInfo[] = [];
let currentDeviceIndex = 0;
let permissionGrantedThisSession = false;

// DOM element references (set by main.ts)
let video: HTMLVideoElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let cameraSelect: HTMLSelectElement;
let cameraLabel: HTMLElement;
let cameraDot: HTMLElement;
let errorBox: HTMLElement;
let errorText: HTMLElement;

export function initCameraElements(elements: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  cameraSelect: HTMLSelectElement;
  cameraLabel: HTMLElement;
  cameraDot: HTMLElement;
  errorBox: HTMLElement;
  errorText: HTMLElement;
}) {
  video = elements.video;
  canvas = elements.canvas;
  ctx = canvas.getContext('2d')!;
  cameraSelect = elements.cameraSelect;
  cameraLabel = elements.cameraLabel;
  cameraDot = elements.cameraDot;
  errorBox = elements.errorBox;
  errorText = elements.errorText;
}

export function showError(msg: string) {
  if (!msg) {
    errorBox.hidden = true;
    errorText.textContent = '';
  } else {
    errorBox.hidden = false;
    errorText.textContent = msg;
  }
}

export async function checkCameraPermission(): Promise<PermissionState | 'prompt'> {
  if (localStorage.getItem(PERMISSION_GRANTED_KEY) === 'true') {
    return 'granted';
  }

  if (permissionGrantedThisSession) {
    return 'granted';
  }

  if (navigator.permissions && navigator.permissions.query) {
    try {
      const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (result.state === 'granted') {
        localStorage.setItem(PERMISSION_GRANTED_KEY, 'true');
        permissionGrantedThisSession = true;
      }
      return result.state;
    } catch {
      console.log('Permissions API not available for camera, falling back');
    }
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevs = devices.filter(d => d.kind === 'videoinput');
    if (videoDevs.length > 0 && videoDevs[0].label) {
      localStorage.setItem(PERMISSION_GRANTED_KEY, 'true');
      permissionGrantedThisSession = true;
      return 'granted';
    }
  } catch (e) {
    console.log('enumerateDevices check failed', e);
  }

  return 'prompt';
}

export function markPermissionGranted() {
  localStorage.setItem(PERMISSION_GRANTED_KEY, 'true');
  permissionGrantedThisSession = true;
}

export function clearPermissionStatus() {
  localStorage.removeItem(PERMISSION_GRANTED_KEY);
  permissionGrantedThisSession = false;
}

export function isPermissionGranted(): boolean {
  return permissionGrantedThisSession || localStorage.getItem(PERMISSION_GRANTED_KEY) === 'true';
}

export async function listVideoDevices(selectedId?: string | null) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');

    cameraSelect.innerHTML = '';
    if (videoDevices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Žádná kamera';
      cameraSelect.appendChild(opt);
      cameraLabel.textContent = 'Žádná kamera';
      cameraDot.style.background = '#ff9500';
      return;
    }

    videoDevices.forEach((device, index) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || 'Kamera ' + (index + 1);
      if (selectedId && device.deviceId === selectedId) {
        opt.selected = true;
        currentDeviceIndex = index;
      }
      cameraSelect.appendChild(opt);
    });

    if (!selectedId) {
      const preferred = localStorage.getItem(PREFERRED_CAMERA_KEY);
      if (preferred) {
        const idx = videoDevices.findIndex(d => d.deviceId === preferred);
        if (idx >= 0) {
          cameraSelect.value = preferred;
          currentDeviceIndex = idx;
        }
      }
    }

    const active = videoDevices[currentDeviceIndex] || videoDevices[0];
    cameraLabel.textContent = active ? (active.label || 'Kamera ' + (currentDeviceIndex + 1)) : 'Kamera';
    cameraDot.style.background = '#34c759';
  } catch (e) {
    console.error('enumerateDevices failed', e);
    cameraLabel.textContent = 'Chyba kamery';
    cameraDot.style.background = '#ff9500';
  }
}

export async function initCamera(deviceId?: string | null) {
  showError('');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraLabel.textContent = 'Nepodporováno.';
    cameraDot.style.background = '#ff9500';
    showError('Tento prohlížeč nepodporuje přístup ke kameře.');
    return;
  }

  const permissionStatus = await checkCameraPermission();

  if (permissionStatus === 'denied') {
    cameraLabel.textContent = 'Přístup odepřen';
    cameraDot.style.background = '#ff3b30';
    showError('Přístup ke kameře byl odepřen. Povol kameru v nastavení prohlížeče nebo zařízení.');
    return;
  }

  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }

  const defaultFacingMode = getSettings().defaultCamera || 'environment';
  const constraints: MediaStreamConstraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: defaultFacingMode },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;
    cameraDot.style.background = '#34c759';
    cameraLabel.textContent = 'Kamera běží';

    markPermissionGranted();

    await listVideoDevices(deviceId || cameraSelect.value || null);
  } catch (err) {
    console.error(err);

    const errorName = (err as Error)?.name;

    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
      clearPermissionStatus();
      cameraLabel.textContent = 'Přístup odepřen';
      cameraDot.style.background = '#ff3b30';
      showError('Přístup ke kameře byl odepřen. Povol kameru v nastavení prohlížeče nebo zařízení.');
    } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
      cameraLabel.textContent = 'Kamera nenalezena';
      cameraDot.style.background = '#ff9500';
      showError('Kamera nebyla nalezena. Zkontroluj, zda je kamera připojená.');
    } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
      cameraLabel.textContent = 'Kamera obsazená';
      cameraDot.style.background = '#ff9500';
      showError('Kamera je používána jinou aplikací.');
    } else {
      cameraLabel.textContent = 'Nelze spustit';
      cameraDot.style.background = '#ff9500';
      showError('Nepodařilo se spustit kameru: ' + ((err as Error)?.message || err));
    }
  }
}

export function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    cameraLabel.textContent = 'Pozastaveno';
    cameraDot.style.background = '#ff9500';
  }
}

export function switchCamera() {
  if (!videoDevices.length) return;
  currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
  const dev = videoDevices[currentDeviceIndex];
  if (dev) {
    cameraSelect.value = dev.deviceId;
    localStorage.setItem(PREFERRED_CAMERA_KEY, dev.deviceId);
    initCamera(dev.deviceId);
  }
}

export function selectCamera(deviceId: string) {
  localStorage.setItem(PREFERRED_CAMERA_KEY, deviceId);
  initCamera(deviceId);
}

export function getPreferredCameraId(): string | null {
  return localStorage.getItem(PREFERRED_CAMERA_KEY);
}

export async function capturePhoto(): Promise<boolean> {
  showError('');

  if (!currentStream) {
    showError('Kamera neběží.');
    return false;
  }

  if (!video.videoWidth || !video.videoHeight) {
    showError('Video ještě není připravené.');
    return false;
  }

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const maxWidth = getMaxWidth();
  const maxHeight = getMaxHeight();

  let targetW = srcW;
  let targetH = srcH;

  if (srcW > maxWidth || srcH > maxHeight) {
    const scale = Math.min(maxWidth / srcW, maxHeight / srcH);
    targetW = Math.round(srcW * scale);
    targetH = Math.round(srcH * scale);
  }

  canvas.width = targetW;
  canvas.height = targetH;
  ctx.drawImage(video, 0, 0, targetW, targetH);

  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          showError('Nepodařilo se vytvořit snímek.');
          resolve(false);
          return;
        }
        try {
          await savePhotoBlob(blob);
          resolve(true);
        } catch (e) {
          console.error(e);
          showError('Uložení snímku se nepodařilo.');
          resolve(false);
        }
      },
      'image/jpeg',
      getJpegQuality()
    );
  });
}
