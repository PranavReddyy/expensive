import "./globals.css";
import AppRuntime from "../components/AppRuntime";
import AuthProvider from "../components/AuthProvider";
import Preferences from "../components/Preferences";
import localFont from 'next/font/local';

const plex = localFont({
  src: [
    {path:'../ios/Expensive/Fonts/IBMPlexMono-Regular.ttf',weight:'400'},
    {path:'../ios/Expensive/Fonts/IBMPlexMono-Medium.ttf',weight:'500'},
    {path:'../ios/Expensive/Fonts/IBMPlexMono-SemiBold.ttf',weight:'600'},
  ],
  variable:'--font-plex', display:'swap', preload:false,
});

export const dynamic = "force-dynamic";

export const metadata = {
  title: "expensive",
  description: "personal expense tracker",
  manifest: "/manifest.json?v=newnew-1",
  icons: {
    icon: [
      { url: "/favicon.svg?v=newnew-1", type: "image/svg+xml" },
      { url: "/favicon.ico?v=newnew-1", sizes: "any" },
      { url: "/favicon-96x96.png?v=newnew-1", type: "image/png", sizes: "96x96" },
    ],
    shortcut: "/favicon.ico?v=newnew-1",
    apple: [
      { url: "/apple-touch-icon-120x120.png?v=newnew-1", sizes: "120x120", type: "image/png" },
      { url: "/apple-touch-icon-152x152.png?v=newnew-1", sizes: "152x152", type: "image/png" },
      { url: "/apple-touch-icon-167x167.png?v=newnew-1", sizes: "167x167", type: "image/png" },
      { url: "/apple-touch-icon.png?v=newnew-1", sizes: "180x180", type: "image/png" },
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
    <html lang="en" className={plex.variable}>
      <head>
        {/* Prevent zoom everywhere — user-scalable=no plus min/max scale */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* Disable tap highlight on iOS */}
        <meta name="format-detection" content="telephone=no" />
        <script src="/disable-zoom.js" defer></script>
      </head>
      <body className="bg-white no-zoom"><AuthProvider><Preferences><AppRuntime />{children}</Preferences></AuthProvider></body>
    </html>
  );
}
