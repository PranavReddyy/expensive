// disable-zoom.js
// Intentionally prevents user zooming across the app:
// - Ctrl/Cmd + +/-/0
// - Ctrl/Cmd + mousewheel/trackpad pinch
// - iOS gesture events (pinch)
// - double-tap zoom
// NOTE: Disabling zoom impairs accessibility. Keep this only if you understand the tradeoffs.
(function () {
  'use strict';

  // Prevent keyboard zoom shortcuts (Ctrl/Cmd + +/-/0)
  window.addEventListener('keydown', function (e) {
    try {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key;
        if (key === '+' || key === '-' || key === '=' || key === '0') {
          e.preventDefault();
          return false;
        }
      }
    } catch (err) {
      // ignore
    }
  }, { passive: false });

  // Prevent pinch/ctrl+wheel zoom (Chrome, Firefox)
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return false;
    }
  }, { passive: false });

  // Prevent Safari iOS gesture events
  function stopGesture(e) {
    e.preventDefault();
    return false;
  }
  window.addEventListener('gesturestart', stopGesture, { passive: false });
  window.addEventListener('gesturechange', stopGesture, { passive: false });
  window.addEventListener('gestureend', stopGesture, { passive: false });

  // Prevent double-tap to zoom
  var lastTouchEnd = 0;
  window.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  // Prevent multi-touch/pinch by tracking pointer count
  var pointerCount = 0;
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') {
      pointerCount++;
      if (pointerCount > 1) {
        e.preventDefault();
        return false;
      }
    }
  }, { passive: false });
  window.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch') {
      pointerCount = Math.max(0, pointerCount - 1);
    }
  }, { passive: false });

  // Best-effort: set touch-action to manipulation on root element
  try {
    document.documentElement.style.touchAction = 'manipulation';
  } catch (err) {
    // ignore
  }
})();
