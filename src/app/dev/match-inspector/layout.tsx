import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Match inspector (dev)",
  robots: { index: false, follow: false },
};

export default function DevMatchInspectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
