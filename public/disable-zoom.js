// disable-zoom.js
// Intentionally prevents user zooming across the app:
// - Ctrl/Cmd + +/-/0
// - Ctrl/Cmd + mousewheel/trackpad pinch
// - iOS gesture events (pinch)
// - double-tap zoom
// NOTE: Disabling zoom impairs accessibility. Keep this only if you understand the tradeoffs.
(function () {
  "use strict";

  function blockEvent(e) {
    try {
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (err) {}
    return false;
  }

  // Prevent keyboard zoom shortcuts (Ctrl/Cmd + +/-/0 and numpad)
  window.addEventListener(
    "keydown",
    function (e) {
      try {
        if (e.ctrlKey || e.metaKey) {
          const key = (e.key || "").toString();
          const code = (e.code || "").toString();
          const keyCode = e.keyCode || e.which || 0;

          var isZoomKey = false;
          if (key === "+" || key === "-" || key === "=" || key === "0")
            isZoomKey = true;
          if (
            code === "Equal" ||
            code === "Minus" ||
            code === "NumpadAdd" ||
            code === "NumpadSubtract"
          )
            isZoomKey = true;
          if ([187, 189, 107, 109, 48].indexOf(keyCode) !== -1)
            isZoomKey = true;

          if (isZoomKey) return blockEvent(e);
        }
      } catch (err) {
        // ignore
      }
    },
    { passive: false },
  );

  // Prevent pinch/ctrl+wheel zoom (Chrome, Firefox)
  window.addEventListener(
    "wheel",
    function (e) {
      if (e.ctrlKey || e.metaKey) return blockEvent(e);
    },
    { passive: false },
  );

  // Prevent Safari iOS gesture events
  window.addEventListener("gesturestart", blockEvent, { passive: false });
  window.addEventListener("gesturechange", blockEvent, { passive: false });
  window.addEventListener("gestureend", blockEvent, { passive: false });

  // Prevent double-tap to zoom
  var lastTouchEnd = 0;
  window.addEventListener(
    "touchend",
    function (e) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) return blockEvent(e);
      lastTouchEnd = now;
    },
    { passive: false },
  );

  // Prevent multi-touch/pinch via touchstart/touchmove
  window.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches && e.touches.length > 1) return blockEvent(e);
    },
    { passive: false },
  );
  window.addEventListener(
    "touchmove",
    function (e) {
      if (e.touches && e.touches.length > 1) return blockEvent(e);
    },
    { passive: false },
  );

  // Prevent multi-touch/pinch by tracking pointer count as a fallback
  var pointerCount = 0;
  window.addEventListener(
    "pointerdown",
    function (e) {
      if (e.pointerType === "touch") {
        pointerCount++;
        if (pointerCount > 1) return blockEvent(e);
      }
    },
    { passive: false },
  );
  window.addEventListener(
    "pointerup",
    function (e) {
      if (e.pointerType === "touch")
        pointerCount = Math.max(0, pointerCount - 1);
    },
    { passive: false },
  );

  // Best-effort: set touch-action to manipulation on root element
  try {
    document.documentElement.style.touchAction = "manipulation";
  } catch (err) {
    // ignore
  }
})();
