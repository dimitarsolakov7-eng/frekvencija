import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER } from "./layout";

/** Final deep-green call to action: "Your space deserves its own station." */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="pb-16 sm:pb-20">
      <div className={PUBLIC_CONTAINER}>
        <div
          className={cn(
            "flex flex-col gap-6 rounded-card border border-accent/25 px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between",
            "bg-[linear-gradient(110deg,rgb(25_184_130/0.16),rgb(21_32_28)_55%,rgb(25_184_130/0.10))] shadow-card",
          )}
        >
          <div className="grid gap-2">
            <h2 id="cta-title" className="text-2xl font-bold tracking-tight text-fg text-balance sm:text-3xl">
              Your space deserves its own station.
            </h2>
            <p className="max-w-xl text-fg-muted text-pretty">
              Create a unique atmosphere for your guests with a radio station made for your business.
            </p>
          </div>
          <ButtonLink
            href="/request-access"
            size="lg"
            iconRight={<ArrowRight aria-hidden="true" />}
            className="w-full sm:w-auto lg:min-w-52"
          >
            Request access
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
