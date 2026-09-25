import type { Metadata } from "next";
import Link from "next/link";
import { House } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex flex-1 flex-col items-center justify-center gap-10 px-page py-16 text-center focus:outline-none"
    >
      <Link href="/" className="rounded-control">
        <BrandLogo tone="ivory" size="lg" />
      </Link>
      <div className="grid max-w-md gap-3">
        <p className="eyebrow text-accent-text">Error 404</p>
        <h1 className="page-title text-fg">This page isn’t on the air</h1>
        <p className="text-fg-muted text-pretty">
          The address may be mistyped, or the page was moved or removed. If you followed a link from an email, it
          may have expired.
        </p>
      </div>
      <ButtonLink href="/" size="lg" icon={<House aria-hidden="true" />}>
        Go to the start page
      </ButtonLink>
    </main>
  );
}
