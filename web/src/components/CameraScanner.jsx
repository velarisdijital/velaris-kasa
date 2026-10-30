// Telefon / tablet kamerasıyla barkod okuma.
// Tarayıcı destekliyorsa yerleşik BarcodeDetector, yoksa ZXing kütüphanesi (ihtiyaç anında yüklenir).
// Not: Tarayıcılar kamerayı yalnızca güvenli bağlantıda (https:// ya da localhost) açar.
import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui.jsx';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 1200;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch { /* ses yok */ }
}

export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

export default function CameraScanner({ onResult, onClose, title = 'Kamerayla barkod okut' }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    let stream;
    let stopped = false;
    let controls;
    const done = (code) => {
      if (stopped) return;
      stopped = true;
      beep();
      if (navigator.vibrate) navigator.vibrate(60);
      resultRef.current(code);
    };

    (async () => {
      if (!window.isSecureContext) {
        setError('Kamera yalnızca güvenli bağlantıda (https) çalışır. Programı https adresinden açın ya da USB/Bluetooth barkod okuyucu kullanın.');
        return;
      }
      if (!cameraSupported()) { setError('Bu cihazda kamera kullanılamıyor.'); return; }
      try {
        if ('BarcodeDetector' in window) {
          const supported = await window.BarcodeDetector.getSupportedFormats?.().catch(() => []) || [];
          const detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => !supported.length || supported.includes(f)) });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
          if (stopped) return;
          video.current.srcObject = stream;
          await video.current.play();
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video.current);
              if (codes[0]?.rawValue) return done(codes[0].rawValue);
            } catch { /* kare hazır değil */ }
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (result) => {
            if (result) done(result.getText());
          });
          if (stopped) controls.stop();
        }
      } catch (e) {
        setError(e?.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Tarayıcı ayarlarından bu siteye kamera izni verin.'
          : e?.name === 'NotFoundError' ? 'Kamera bulunamadı.' : `Kamera açılamadı: ${e?.message || e}`);
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Modal title={title} onClose={onClose}>
      {error ? <p className="danger-text">{error}</p> : (
        <div className="camera-box">
          <video ref={video} muted playsInline />
          <div className="camera-aim" aria-hidden="true" />
          <p className="muted small-text">Barkodu çerçevenin içine getirin.</p>
        </div>
      )}
    </Modal>
  );
}
