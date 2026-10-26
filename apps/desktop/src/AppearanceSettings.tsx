import React, { useEffect, useState } from 'react';
import { accents, modes, loadAppearance, applyAppearance } from './appearance.mjs';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
// Apply before the first React render to avoid a light flash on dark desktops.
applyAppearance(loadAppearance(localStorage), document.documentElement, systemTheme.matches);
export function AppearanceSettings() {
  const [value, setValue] = useState(() => loadAppearance(localStorage));
  const [error, setError] = useState(false);
  useEffect(() => {
    const apply = () => applyAppearance(value, document.documentElement, systemTheme.matches);
    apply();
    systemTheme.addEventListener('change', apply);
    try { localStorage.setItem('workspace.appearance', JSON.stringify(value)); setError(false); }
    catch { setError(true); }
    return () => systemTheme.removeEventListener('change', apply);
  }, [value]);
  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <h3 id="appearance-title">Görünüm</h3>
    <fieldset><legend>Tema</legend><div className="theme-options">
      {Object.entries(modes).map(([id, label]) => <label key={id}><input type="radio" name="theme" value={id} checked={value.mode === id} onChange={() => setValue({ ...value, mode: id })} /><span>{String(label)}</span></label>)}
    </div></fieldset>
    <fieldset><legend>Vurgu rengi</legend><div className="accent-options">
      {Object.entries(accents).map(([id, label]) => <label key={id}><input type="radio" name="accent" value={id} checked={value.accent === id} onChange={() => setValue({ ...value, accent: id })} /><span><i className={'swatch ' + id} />{String(label)}</span></label>)}
    </div></fieldset>
    <p className="quiet" role={error ? 'alert' : undefined}>{error ? 'Görünüm değişti ancak bu cihazda kaydedilemedi.' : 'Bu cihazda kaydedilir. Sistem modu bilgisayarının görünümünü izler.'}</p>
  </section>;
}
// Keep system following alive even while the settings dialog is closed.
systemTheme.addEventListener('change', () => applyAppearance(loadAppearance(localStorage), document.documentElement, systemTheme.matches));
