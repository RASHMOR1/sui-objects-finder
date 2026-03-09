import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sui Package Object Finder",
  description: "Search live Sui objects by package lineage.",
};

const themeInitScript = `
(() => {
  const key = "sui-object-finder-theme";
  const root = document.documentElement;

  try {
    const storedTheme = window.localStorage.getItem(key);
    const theme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";

    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  } catch {
    root.dataset.theme = "dark";
    root.style.colorScheme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
