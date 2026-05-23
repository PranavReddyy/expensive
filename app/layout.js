import "./globals.css";

export const metadata = {
  title: "Expense Tracker",
  description: "Personal expense tracker app",
  manifest: "/site.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: {
      url: "/apple-touch-icon.png",
      sizes: "180x180",
    },
    other: {
      rel: "icon",
      url: "/favicon.svg",
      type: "image/svg+xml",
    },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <meta name="theme-color" content="#1f2937" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Expenses" />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon.png"
          sizes="180x180"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
