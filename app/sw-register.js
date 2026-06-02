// ── Registro del Service Worker ──
let _swReg = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      _swReg = await navigator.serviceWorker.register('sw.js');

      // Verificar actualizaciones del SW cada vez que la app recupera el foco.
      // El contenido ya se sirve network-first, así que esto solo aplica
      // cuando hay una nueva versión del propio sw.js desplegada.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _swReg) _swReg.update();
      });

    } catch (err) {
      console.warn('SW no disponible:', err);
    }
  });

  // Cuando el nuevo SW toma control (tras skipWaiting), recargar la página.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

// Llamada desde el banner de actualización (si se reactiva en el futuro)
function pwaUpdate() {
  if (_swReg && _swReg.waiting) {
    _swReg.waiting.postMessage('SKIP_WAITING');
  }
}
