import type { Metadata } from "next";
import Link from "next/link";
import { Waveform } from "@/components/ui";
import { FORM_LINK_CLASSES, FormHeading } from "@/components/public/FormHeading";
import { PUBLIC_CONTAINER } from "@/components/public/layout";
import { RequestAccessForm } from "@/components/public/RequestAccessForm";
import { VenuePhoto } from "@/components/public/VenuePhoto";
import { loadPublicSettings } from "@/lib/data/public";
import { cn } from "@/lib/utils/cn";
import { requestAccess } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request access",
  description: "Tell us about your business and we’ll get in touch about setting up your own radio station.",
};

const NEXT_STEPS = [
  "Tell us about your business.",
  "We review your request and reply by email.",
  "If we set up your station, you’ll get an invitation to choose your own password.",
] as const;

/** Photo side panel of the form system: the venue photograph with the "what happens next" steps. */
function RequestAccessPanel() {
  return (
    <section
      aria-labelledby="next-steps-title"
      className="relative isolate flex min-h-80 flex-col justify-end overflow-hidden p-6 sm:p-10 lg:order-first lg:min-h-full"
    >
      <div className="absolute inset-0 -z-10">
        <VenuePhoto
          sizes="(min-width: 1024px) 45vw, 100vw"
          imageClassName="object-[60%_50%]"
          overlays={["bg-canvas/25", "bg-linear-to-t from-canvas via-canvas/70 to-canvas/0"]}
        />
      </div>
      <div className="grid gap-6">
        <Waveform bars={28} className="h-8 w-44" />
        <p className="max-w-sm text-3xl leading-tight font-bold tracking-tight text-fg text-balance sm:text-4xl">
          Your space deserves its own station.
        </p>
        <div className="grid gap-3">
          <h2 id="next-steps-title" className="text-sm font-semibold text-fg">
            What happens next
          </h2>
          <ol className="grid gap-3 text-sm text-fg-muted">
            {NEXT_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/40 bg-canvas/60 text-xs font-semibold text-accent-text"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5 text-pretty">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/**
 * /request-access — public form for businesses that want a station (the header's and CTA's "Request
 * access", and the footer's "Contact"). Submissions land in the owner's access-request list; nothing
 * is approved automatically.
 */
export default async function RequestAccessPage() {
  const settings = await loadPublicSettings();
  const contactEmail = settings.status === "ok" ? settings.settings.contactEmail : null;

  return (
    <div className={cn(PUBLIC_CONTAINER, "py-8 sm:py-12 lg:py-16")}>
      <div className="grid overflow-hidden rounded-card border border-border bg-canvas shadow-card lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="grid content-start gap-8 bg-canvas px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-14">
          <FormHeading
            eyebrow="Request access"
            title="Get your own station"
            description="Tell us about your business and we’ll get in touch about setting up your radio."
          />
          <RequestAccessForm action={requestAccess} contactEmail={contactEmail} />
          <p className="border-t border-border pt-6 text-center text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href="/login" className={FORM_LINK_CLASSES}>
              Log in
            </Link>
          </p>
        </div>
        <RequestAccessPanel />
      </div>
    </div>
  );
}
