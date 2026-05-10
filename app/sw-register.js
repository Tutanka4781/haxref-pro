// ── Registro del Service Worker ──
let _swReg = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      _swReg = await navigator.serviceWorker.register('sw.js');

      // Detectar cuando hay un nuevo SW esperando
      _swReg.addEventListener('updatefound', () => {
        const newWorker = _swReg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Hay versión nueva lista — mostrar banner
            document.getElementById('pwa-update-banner').style.display = 'flex';
          }
        });
      });

      // Verificar actualizaciones cada vez que la app recupera el foco
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _swReg) _swReg.update();
      });

    } catch (err) {
      console.warn('SW no disponible:', err);
    }
  });

  // Recargar cuando el nuevo SW tome control
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

function pwaUpdate() {
  if (_swReg && _swReg.waiting) {
    _swReg.waiting.postMessage('SKIP_WAITING');
  }
}
