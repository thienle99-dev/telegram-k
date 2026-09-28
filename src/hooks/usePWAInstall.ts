import {createRoot, createSignal} from 'solid-js';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>,
  userChoice: Promise<{outcome: 'accepted' | 'dismissed', platform: string}>
};

const [canInstall, setCanInstall] = createRoot(() => createSignal(false));
const [isInstalled, setIsInstalled] = createRoot(() => createSignal(false));
let deferredPrompt: InstallPromptEvent;

function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true;
}

const displayMode = window.matchMedia('(display-mode: standalone)');
setIsInstalled(isAppInstalled());
displayMode.addEventListener('change', () => setIsInstalled(isAppInstalled()));

window.addEventListener('beforeinstallprompt', (event: Event) => {
  event.preventDefault();
  deferredPrompt = event as InstallPromptEvent;
  setCanInstall(true);
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = undefined;
  setCanInstall(false);
  setIsInstalled(true);
});

export default function usePWAInstall() {
  async function installApp() {
    if(!deferredPrompt) return;

    const prompt = deferredPrompt;
    deferredPrompt = undefined;
    setCanInstall(false);
    await prompt.prompt();
    const {outcome} = await prompt.userChoice;
    if(outcome === 'accepted') setIsInstalled(true);
  }

  return {canInstall, isInstalled, installApp};
}
