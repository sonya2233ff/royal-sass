import type { Metadata } from "next";
import { SiteNav } from "./SiteNav";

export const metadata: Metadata = {
  title: "Royal SASS — Price POC",
  description: "Store-specific grocery price comparison POC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
