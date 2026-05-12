import { useEffect, useState } from 'react';

const DISMISS_KEY = 'subbi:updateDismissed:v1';

type Props = {
  labels: {
    available: (v: string) => string;
    download: string;
    dismiss: string;
  };
};

export default function UpdateBanner({ labels }: Props) {
  const [latest, setLatest] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState<string>('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.subbi.checkForUpdates();
        if (cancelled) return;
        if (!res.hasUpdate || !res.latest) return;
        const dismissed = localStorage.getItem(DISMISS_KEY);
        if (dismissed === res.latest) return;
        setLatest(res.latest);
        setReleaseUrl(res.releaseUrl);
        setVisible(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (!visible || !latest) return null;

  return (
    <div className="update-banner">
      <span className="update-banner__text">{labels.available(latest)}</span>
      <button
        className="update-banner__btn update-banner__btn--primary"
        onClick={() => window.subbi.openExternal(releaseUrl)}
      >
        {labels.download}
      </button>
      <button
        className="update-banner__btn"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, latest);
          setVisible(false);
        }}
        aria-label={labels.dismiss}
      >
        ×
      </button>
    </div>
  );
}
