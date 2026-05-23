import "./globals.css";

export const metadata = {
  title: "expensive",
  description: "personal expense tracker",
  // PWA / iOS
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "expensive",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Prevent zoom everywhere — user-scalable=no is the key */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />

        {/* Standard favicon — put favicon.ico in /public */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="expensive" />

        {/* Android PWA — links to /public/manifest.json */}
        <link rel="manifest" href="/manifest.json" />

        {/* Disable tap highlight on iOS */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
