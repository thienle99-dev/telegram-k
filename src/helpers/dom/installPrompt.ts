import usePWAInstall from '@hooks/usePWAInstall';

export function getInstallPrompt() {
  const {canInstall, installApp} = usePWAInstall();
  return canInstall() ? installApp : undefined;
}

export function canShowIOSInstallInstructions() {
  const {isInstalled} = usePWAInstall();
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !isInstalled();
}
