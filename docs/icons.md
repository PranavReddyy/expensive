# App icons

`public/newnew.svg` is the only source artwork. Run `npm run icons` after editing it; the generator preserves its paths and changes only size, padding, and monochrome appearance.

- Web: adaptive SVG favicon, multi-size ICO, PNG fallback, Apple touch icons, and separate maskable PWA artwork with safe padding.
- Native iOS: 1024px default (black on white), dark (white on charcoal), and grayscale tinted appearances. All three are opaque PNGs without pre-rounded corners.
- Xcode's asset catalog selects native appearances automatically. The web app's Apple touch icon is a static image; Safari does not offer the same explicit appearance slots as a native app.

Rebuild the native app to install the new icon. Existing Home Screen web shortcuts may retain their old cached artwork; remove and re-add the shortcut after deploying the update. Metadata URLs are versioned to refresh browser caches.

These are flat asset-catalog variants, not a layered Icon Composer icon. Clear/tinted system treatments remain controlled by iOS. Check the installed app in light, dark, and tinted Home Screen modes before release.

Reference: [Apple app icon configuration](https://developer.apple.com/documentation/xcode/configuring-your-app-icon).
