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

  // CSS touch-action and the viewport handle touch zoom without blocking the
  // scrolling thread or swallowing a second rapid tap on an interactive control.

  // Best-effort: set touch-action to manipulation on root element
  try {
    document.documentElement.style.touchAction = "manipulation";
  } catch (err) {
    // ignore
  }
})();
