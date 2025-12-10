// PWA and install management

let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// DOM element references (set by main.ts)
let installButton: HTMLButtonElement;
let installHint: HTMLElement;

export function initPwaElements(elements: {
  installButton: HTMLButtonElement;
  installHint: HTMLElement;
}) {
  installButton = elements.installButton;
  installHint = elements.installHint;
}

export function isStandalonePwa(): boolean {
  const mqStandalone =
    window.matchMedia &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches);
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mqStandalone || iosStandalone;
}

export function detectPlatformInstallHint(): string {
  if (isStandalonePwa()) {
    return 'Aplikace je nainstalovaná.';
  }
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isAndroid = /Android/.test(ua);
  if (isIos) {
    return 'V Safari použij „Přidat na plochu".';
  }
  if (isAndroid) {
    return 'V menu prohlížeče zvol „Instalovat aplikaci".';
  }
  return 'Instalaci najdeš v menu prohlížeče.';
}

export function setupInstallHandlers(basePath: string) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installButton.hidden = false;
    installHint.textContent = detectPlatformInstallHint();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(`${basePath}sw.js`)
      .then(() => {
        console.log('Service worker registrován.');
      })
      .catch((err) => {
        console.error('SW registrace selhala:', err);
      });
  }

  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
      installHint.textContent = detectPlatformInstallHint();
      return;
    }

    deferredPrompt.prompt();

    try {
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        installHint.textContent = 'Instalace spuštěna.';
      } else {
        installHint.textContent = 'Instalaci můžeš spustit později v menu.';
      }
    } catch (e) {
      console.error(e);
    } finally {
      deferredPrompt = null;
      installButton.hidden = true;
    }
  });

  // Set initial hint
  installHint.textContent = detectPlatformInstallHint();
}

export function updateOnlineStatus(onlineDot: HTMLElement, onlineStatus: HTMLElement) {
  const online = navigator.onLine;
  onlineDot.classList.toggle('offline', !online);
  onlineStatus.textContent = online ? 'Online' : 'Offline';
}

export function updateModeStatus(modeLabel: HTMLElement) {
  modeLabel.textContent = isStandalonePwa() ? 'Aplikace' : 'V prohlížeči';
}
