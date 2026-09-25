import { ArrowRight, FileText, Mail } from "lucide-react";
import { Alert, ButtonLink } from "@/components/ui";
import type { PublicSettingsResult } from "@/lib/data/public";
import { cn } from "@/lib/utils/cn";
import { EYEBROW_CLASSES } from "./layout";
import { policyParagraphs } from "./policy-text";

export interface PolicyPageProps {
  /** Visible page title, e.g. "Privacy policy". */
  title: string;
  /** Lower-case noun for sentences, e.g. "privacy policy". */
  noun: string;
  /** The noun is plural ("terms of service haven’t…"). */
  plural?: boolean;
  /** Which text of the settings to show. */
  kind: "privacyPolicy" | "termsOfService";
  result: PublicSettingsResult;
}

function ContactPath({ contactEmail }: { contactEmail: string | null }) {
  if (contactEmail) {
    return (
      <ButtonLink href={`mailto:${contactEmail}`} variant="secondary" icon={<Mail aria-hidden="true" />}>
        Email {contactEmail}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href="/request-access" variant="secondary" iconRight={<ArrowRight aria-hidden="true" />}>
      Contact us
    </ButtonLink>
  );
}

/**
 * /privacy and /terms: the owner's text from platform settings as plain paragraphs, or an honest
 * "not published yet" / "couldn't be loaded" state with a way to get in touch.
 */
export function PolicyPage({ title, noun, plural = false, kind, result }: PolicyPageProps) {
  const settings = result.status === "ok" ? result.settings : null;
  const paragraphs = policyParagraphs(settings?.[kind]);

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="grid gap-3 border-b border-border pb-8">
        <p className={cn(EYEBROW_CLASSES, "text-fg-muted")}>Legal</p>
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
      </header>

      {paragraphs.length > 0 ? (
        <>
          <div className="grid gap-5 pt-8 text-base leading-relaxed text-fg-muted">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line break-words text-pretty">
                {paragraph}
              </p>
            ))}
          </div>
          <footer className="mt-10 grid gap-3 border-t border-border pt-6">
            <p className="text-sm text-fg-muted">Questions about our {noun}?</p>
            <div>
              <ContactPath contactEmail={settings?.contactEmail ?? null} />
            </div>
          </footer>
        </>
      ) : result.status === "unavailable" ? (
        <div className="grid gap-4 pt-8">
          <Alert
            tone="warning"
            title={`Our ${noun} couldn’t be loaded`}
            description="Please try again in a moment. If the problem continues, contact us."
          />
          <div>
            <ContactPath contactEmail={null} />
          </div>
        </div>
      ) : (
        <div className="grid gap-5 pt-8">
          <div className="flex items-start gap-4 rounded-card border border-border bg-surface p-5 sm:p-6">
            <FileText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-fg-muted" />
            <div className="grid gap-1.5">
              <h2 className="text-lg font-semibold text-fg">Not published yet</h2>
              <p className="text-fg-muted text-pretty">
                {`Our ${noun} ${plural ? "haven’t" : "hasn’t"} been published yet. If you have a question in the meantime, please get in touch.`}
              </p>
            </div>
          </div>
          <div>
            <ContactPath contactEmail={settings?.contactEmail ?? null} />
          </div>
        </div>
      )}
    </article>
  );
}
