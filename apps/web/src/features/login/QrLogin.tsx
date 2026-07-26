import {
  useEffect,
  useState
} from "react";

type QrLoginProps = Readonly<{
  refreshAfterMs?: number;
}>;

export function QrLogin({
  refreshAfterMs = 60_000
}: QrLoginProps) {
  const [nonce, setNonce] = useState(() => cryptoNonce());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNonce(cryptoNonce());
    }, refreshAfterMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [nonce, refreshAfterMs]);

  return (
    <div className="qr-login">
      <div className="qr-frame">
        <img
          src={`/api/max/login/qr?nonce=${encodeURIComponent(nonce)}`}
          alt="QR-код для входа в MAX"
        />
      </div>
      <p className="muted">
        Откройте MAX на другом устройстве и отсканируйте код.
      </p>
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          setNonce(cryptoNonce());
        }}
      >
        Обновить QR-код
      </button>
    </div>
  );
}

function cryptoNonce(): string {
  return globalThis.crypto.randomUUID();
}
