import { createSignal, onMount, Show } from 'solid-js';
import QRCode from 'qrcode';

export function GuestQr() {
  const guestUrl = new URL('/', window.location.origin);
  const configured = import.meta.env.VITE_GUEST_URL?.trim();
  let url = guestUrl;
  if (configured) {
    try {
      const candidate = new URL(configured);
      if (['http:', 'https:'].includes(candidate.protocol)) url = candidate;
    } catch {
      // Keep the participant page on the current origin if the override is invalid.
    }
  }

  const [qrImage, setQrImage] = createSignal('');
  onMount(async () => {
    try {
      setQrImage(await QRCode.toDataURL(url.href, {
        errorCorrectionLevel: 'M',
        margin: 4,
        scale: 12,
        color: { dark: '#391021', light: '#e6b1c4' },
      }));
    } catch (error) {
      console.error('No se pudo generar el código QR de la sala.', error);
    }
  });

  return (
    <a class="tv-join" href={url.href}>
      <div class="tv-join-copy">
        <strong>{qrImage() ? 'Escanea el QR' : 'Pon tu música'}</strong>
        <Show when={qrImage()}>
          <span>para poner tu música</span>
        </Show>
      </div>
      <Show when={qrImage()}>
        <img class="tv-join-qr" src={qrImage()} alt="" />
      </Show>
      <span class="tv-join-url">{url.href}</span>
    </a>
  );
}
