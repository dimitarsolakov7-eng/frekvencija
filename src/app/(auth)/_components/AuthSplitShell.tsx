import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { VenuePhoto } from "@/components/public/VenuePhoto";
import { SkipLink, Waveform } from "@/components/ui";
import { PLATFORM_DOMAIN, PLATFORM_NAME } from "@/config/platform";

export interface AuthSplitShellProps {
  children: ReactNode;
}

/**
 * Screen 02 form system: desktop is a 55/45 split — the warm venue photograph (dark overlay, logo,
 * waveform, "Your atmosphere. One click away.") and a calm ~380px form column. Tablet and mobile get a
 * single column with the photograph reduced to a small header. Static branding only, so it works in
 * setup mode too.
 */
export function AuthSplitShell({ children }: AuthSplitShellProps) {
  return (
    <>
      <SkipLink />
      <div className="flex flex-1 flex-col lg:grid lg:min-h-dvh lg:grid-cols-[55fr_45fr]">
        <header className="relative isolate h-40 overflow-hidden sm:h-52 lg:h-auto lg:border-r lg:border-border">
          <div className="absolute inset-0 -z-10">
            <VenuePhoto
              eager
              sizes="(min-width: 1024px) 55vw, 100vw"
              imageClassName="object-[38%_55%]"
              overlays={[
                "bg-black/10 lg:bg-black/30",
                "bg-linear-to-t from-canvas via-canvas/15 to-canvas/30 lg:from-canvas/95 lg:via-canvas/10 lg:to-canvas/40",
              ]}
            />
          </div>
          <div className="p-4 sm:p-6 lg:p-12">
            <Link href="/" aria-label={`${PLATFORM_NAME} home`} className="inline-block rounded-control py-1">
              <BrandLogo size="lg" />
            </Link>
          </div>
          <div className="absolute inset-x-0 bottom-0 hidden p-12 lg:block xl:p-16">
            <Waveform bars={36} className="mb-8 h-10 w-56" />
            <p className="text-5xl leading-[1.04] font-bold tracking-tight text-fg xl:text-6xl">
              Your atmosphere.
              <br />
              One click away.
            </p>
            <p className="mt-4 text-xl text-fg/85">Sign in and let your station take over.</p>
          </div>
        </header>

        <div className="flex flex-1 flex-col bg-canvas">
          <main
            id="main-content"
            tabIndex={-1}
            className="flex flex-1 flex-col items-center justify-center px-4 py-10 focus:outline-none sm:px-8 lg:py-16"
          >
            <div className="w-full max-w-[380px]">{children}</div>
          </main>
          <footer className="px-4 pb-8 text-center text-sm text-fg-muted">{PLATFORM_DOMAIN}</footer>
        </div>
      </div>
    </>
  );
}
