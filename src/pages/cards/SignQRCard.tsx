import {onCleanup, onMount} from 'solid-js';

import Button from '@components/buttonTsx';
import LanguageChangeButton from '@components/languageChangeButton';
import PasskeyLoginButton from '@components/passkeyLoginButton';
import {putPreloader} from '@components/putPreloader';
import bytesCmp from '@helpers/bytes/bytesCmp';
import bytesToBase64 from '@helpers/bytes/bytesToBase64';
import fixBase64String from '@helpers/fixBase64String';
import pause from '@helpers/schedulers/pause';
import {paintQrCode} from '@helpers/qrCode/paintQrCode';
import type {DcId} from '@types';
import {AuthAuthorization, AuthLoginToken} from '@layer';
import App from '@config/app';
import {i18n} from '@lib/langPack';
import AccountController from '@lib/accounts/accountController';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import rootScope from '@lib/rootScope';

import AuthCard from '@/pages/AuthCard';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signQR'}>;

const FETCH_INTERVAL = 3;
const QR_SIZE = 240;

/**
 * Card variant of `pageSignQR`. Polls `auth.exportLoginToken` in a loop, painting
 * the QR code into the `auth-image` slot. On `loginTokenSuccess` we go to IM; on
 * `SESSION_PASSWORD_NEEDED` to the password card; on cancel/back to the signIn
 * card. The loop terminates when the card unmounts (cleanup flips `stopped`).
 */
export default function SignQRCard(_props: {spec: Spec}) {
  const {managers, navigate, toIm} = useAuthFlow();

  // Persistent host for the QR canvas (qr-code-styling injects its canvas
  // into this div). We hand it to <MediaHeader.Sticker element={...}>.
  let stickerHost: HTMLDivElement;
  let preloader: HTMLElement | undefined;
  let stopped = false;

  // Latest token we've drawn — kept so the theme_changed listener can repaint
  // synchronously without waiting for the next `iterate` cycle to come around.
  let lastDrawnToken: Uint8Array | number[] | undefined;
  let QRCodeStylingCtor: any;

  /* ---------- description list ---------- */

  const helpSteps = [
    'Open Telegram on your phone',
    'Open Settings, then Devices',
    'Choose Link Desktop Device',
    'Scan the code shown here'
  ];
  const helpList = (
    <ol class={styles.qrDescription}>
      {helpSteps.map((step, idx) => (
        <li class={styles.qrDescriptionItem}>
          <span class={styles.qrDescriptionMarker}>{idx + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );

  /* ---------- 'user_auth' subscription ---------- */

  const onUserAuth = () => {
    stopped = true;
  };
  rootScope.addEventListener('user_auth', onUserAuth, {once: true});

  /* ---------- paint QR ---------- */

  // Builds the QR canvas (and its embedded logo) from the current token using the
  // theme's CSS variables. Called on token rotation from `iterate` and on theme
  // change from the `theme_changed` listener so the QR repaints with the new
  // colors without waiting for the next 3-second polling tick.
  async function paintQR(token: Uint8Array | number[]) {
    if(!QRCodeStylingCtor) return;

    const encoded = bytesToBase64(token);
    const url = 'tg://login?token=' + fixBase64String(encoded, true);

    const style = window.getComputedStyle(document.documentElement);
    const surfaceColor = style.getPropertyValue('--light-filled-primary-color').trim();
    const textColor = style.getPropertyValue('--primary-text-color').trim();

    const {canvas} = await paintQrCode({
      data: url,
      size: QR_SIZE,
      host: stickerHost,
      background: surfaceColor,
      foreground: textColor,
      image: 'assets/img/codekit-qr-mark.svg',
      canvasClass: styles.qrCanvas,
      QRCodeStylingCtor
    });

    // ! costyl, but the library doesn't expose any events
    if(preloader) {
      preloader.style.animation = 'hide-icon .4s forwards';

      canvas.style.display = 'none';
      canvas.style.animation = 'grow-icon .4s forwards';
      setTimeout(() => {
        canvas.style.display = '';
      }, 150);
      setTimeout(() => {
        canvas.style.animation = '';
      }, 500);
      preloader = undefined;
    } else {
      Array.from(stickerHost.children).slice(0, -1).forEach((el) => el.remove());
    }

    lastDrawnToken = token;
  }

  /* ---------- theme_changed: repaint with new CSS-variable colors ---------- */

  const onThemeChanged = () => {
    if(stopped || !lastDrawnToken) return;
    paintQR(lastDrawnToken);
  };
  rootScope.addEventListener('theme_changed', onThemeChanged);

  /* ---------- iterate loop ---------- */

  const options: {dcId?: DcId, ignoreErrors: true} = {ignoreErrors: true};
  let prevToken: Uint8Array | number[] | undefined;

  async function iterate(QRCodeStyling: any, isLoop: boolean): Promise<boolean> {
    try {
      const userIds = await AccountController.getUserIds();
      let loginToken = await managers.apiManager.invokeApi('auth.exportLoginToken', {
        api_id: App.id,
        api_hash: App.hash,
        except_ids: userIds.map((userId) => userId.toUserId())
      }, {ignoreErrors: true});

      if(loginToken._ === 'auth.loginTokenMigrateTo') {
        if(!options.dcId) {
          options.dcId = loginToken.dc_id as DcId;
          managers.apiManager.setBaseDcId(loginToken.dc_id);
        }

        loginToken = await managers.apiManager.invokeApi('auth.importLoginToken', {
          token: loginToken.token
        }, options) as AuthLoginToken.authLoginToken;
      }

      if(loginToken._ === 'auth.loginTokenSuccess') {
        const authorization = loginToken.authorization as any as AuthAuthorization.authAuthorization;
        await managers.apiManager.setUser(authorization.user);
        toIm();
        return true;
      }

      if(!prevToken || !bytesCmp(prevToken, loginToken.token)) {
        prevToken = loginToken.token;
        QRCodeStylingCtor = QRCodeStyling;
        await paintQR(loginToken.token);
      }

      if(isLoop) {
        const timestamp = Date.now() / 1000;
        const diff = loginToken.expires - timestamp - await managers.timeManager.getServerTimeOffset();
        await pause(diff > FETCH_INTERVAL ? 1e3 * FETCH_INTERVAL : 1e3 * diff | 0);
      }
    } catch(err) {
      switch((err as ApiError).type) {
        case 'SESSION_PASSWORD_NEEDED':
          navigate({name: 'password'});
          stopped = true;
          break;
        case 'AUTH_TOKEN_EXPIRED':
          console.warn('SignQRCard: AUTH_TOKEN_EXPIRED');
          return false;
        default:
          console.error('SignQRCard: default error:', err);
          stopped = true;
          break;
      }

      return true;
    }

    return false;
  }

  /* ---------- lifecycle ---------- */

  onMount(async() => {
    managers.appStateManager.pushToState('authState', {_: 'authStateSignQr'});

    preloader = putPreloader(stickerHost, true);

    const [{default: QRCodeStyling}] = await Promise.all([
      import('qr-code-styling' as any)
    ]);

    if(stopped) return;

    while(!stopped) {
      const needBreak = await iterate(QRCodeStyling, true);
      if(needBreak || stopped) break;
    }
  });

  onCleanup(() => {
    stopped = true;
    rootScope.removeEventListener('user_auth', onUserAuth);
    rootScope.removeEventListener('theme_changed', onThemeChanged);
  });

  /* ---------- render ---------- */

  return (
    <AuthCard class={styles.pageSignQR} inputWrapper={false}>
      <header class={styles.qrBrandHeader}>
        <div class={styles.qrBrand}>
          <span class={styles.qrBrandMark} aria-hidden="true">C</span>
          <span>CodeKit Connect</span>
        </div>
        <span class={styles.qrSecureLabel}>SECURE DEVICE LINKING</span>
      </header>
      <section class={styles.qrLayout} aria-labelledby="qr-title">
        <div class={styles.qrVisualColumn}>
          <div class={styles.qrContainer}>
            <div ref={stickerHost} class={styles.qrCanvasHost} role="img" aria-label="Secure QR code for linking this session" />
            <span class={styles.qrScanLabel}>SECURE QR</span>
          </div>
          <p class={styles.qrStatus} aria-live="polite">
            <span class={styles.qrStatusDot} aria-hidden="true" />
            {lastDrawnToken ? 'QR code ready to scan' : 'Generating secure QR code…'}
          </p>
        </div>
        <div class={styles.qrInstructions}>
          <p class={styles.qrEyebrow}>DEVICE AUTHENTICATION</p>
          <h1 id="qr-title" class={styles.qrTitle}>Connect your account</h1>
          <p class={styles.qrSubtitle}>Scan this code with your phone to securely link this session.</p>
          <h2 class={styles.qrStepsTitle}>On your phone</h2>
          {helpList}
          <button
            type="button"
            class={styles.qrPhoneButton}
            onClick={() => {
              stopped = true;
              navigate({name: 'signIn'});
            }}
          >
            <span>Use phone number instead</span>
            <span aria-hidden="true">→</span>
          </button>
          <p class={styles.qrDisclosure}>Authentication provided by Telegram</p>
          <p class={styles.qrDisclosureDetail}>This sign-in is handled through Telegram’s authentication system.</p>
          <div class={styles.qrUtilities}>
            {getCurrentAccount() === 1 && <LanguageChangeButton />}
            <PasskeyLoginButton />
          </div>
        </div>
      </section>
    </AuthCard>
  );
}
