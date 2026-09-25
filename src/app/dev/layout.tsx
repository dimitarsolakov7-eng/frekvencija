import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Developer tools",
  robots: { index: false, follow: false },
};

/** Development-only area (/dev/*): every route below it is a 404 in production builds. */
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
