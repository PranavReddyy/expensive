import "./globals.css";

export const metadata = {
  title: "expensive",
  description: "personal expense tracker",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/app-icon-120.png", sizes: "120x120", type: "image/png" },
      { url: "/app-icon-152.png", sizes: "152x152", type: "image/png" },
      { url: "/app-icon-167.png", sizes: "167x167", type: "image/png" },
      { url: "/app-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "expensive",
  },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Prevent zoom everywhere — user-scalable=no plus min/max scale */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* Disable tap highlight on iOS */}
        <meta name="format-detection" content="telephone=no" />
        <script src="/disable-zoom.js"></script>
      </head>
      <body className="bg-white no-zoom">{children}</body>
    </html>
  );
}
