export function setupInstall() {
  const button = document.querySelector('#install-button');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let promptEvent = null;
  let installed = standalone.matches || navigator.standalone === true;
  const update = () => { button.hidden = installed || !window.isSecureContext; };
  update();
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    update();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    update();
    document.querySelector('#install-dialog')?.close();
  });
  standalone.addEventListener('change', event => {
    installed = event.matches || navigator.standalone === true;
    update();
  });
  button.addEventListener('click', async () => {
    if (promptEvent) {
      const pending = promptEvent;
      promptEvent = null;
      try { await pending.prompt(); await pending.userChoice; } catch { showHelp(); }
    } else showHelp();
  });
  function showHelp() {
    let dialog = document.querySelector('#install-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'install-dialog';
      dialog.setAttribute('aria-labelledby', 'install-title');
      const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      dialog.innerHTML = `<h2 id="install-title">Install Andrew Chess</h2><p>Keep Andrew Chess on your home screen for a quick game.</p><p>${appleMobile
        ? 'In Safari, open Share, choose Add to Home Screen, then tap Add.'
        : 'Open your browser menu and choose Install Andrew Chess, Install app, or Add to Home Screen. On Safari for Mac, use File → Add to Dock. If no install option appears, try Chrome, Edge, or Safari.'}</p><button>Back to game</button>`;
      dialog.querySelector('button').onclick = () => dialog.close();
      document.body.append(dialog);
    }
    dialog.showModal();
  }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline support unavailable:', error));
  }
}
