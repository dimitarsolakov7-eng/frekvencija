import { ArrowRight, FileText, Mail } from "lucide-react";
import { Alert, ButtonLink } from "@/components/ui";
import { SECTION_IDS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { PublicSettingsResult } from "@/lib/data/public";
import { fill } from "@/lib/i18n/locale";
import { policyParagraphs } from "./policy-text";
import { Container, Eyebrow } from "./site/primitives";

export interface PolicyPageProps {
  copy: SiteCopy["policy"];
  /** Which text of the settings to show. */
  kind: "privacyPolicy" | "termsOfService";
  result: PublicSettingsResult;
}

function ContactPath({ copy, contactEmail }: { copy: SiteCopy["policy"]; contactEmail: string | null }) {
  if (contactEmail) {
    return (
      <ButtonLink href={`mailto:${contactEmail}`} variant="secondary" className="rounded-full!" icon={<Mail aria-hidden="true" />}>
        {fill(copy.emailUs, { email: contactEmail })}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={sectionHref(SECTION_IDS.trial)} variant="secondary" className="rounded-full!" iconRight={<ArrowRight aria-hidden="true" />}>
      {copy.contactUs}
    </ButtonLink>
  );
}

/**
 * /privacy and /terms: the owner's text from platform settings as plain paragraphs, or an honest
 * "not published yet" / "couldn't be loaded" state with a way to get in touch.
 */
export function PolicyPage({ copy, kind, result }: PolicyPageProps) {
  const settings = result.status === "ok" ? result.settings : null;
  const paragraphs = policyParagraphs(settings?.[kind]);
  const title = kind === "privacyPolicy" ? copy.privacyTitle : copy.termsTitle;
  const noun = kind === "privacyPolicy" ? copy.privacyNoun : copy.termsNoun;

  return (
    <Container className="py-14 sm:py-20">
      <article className="mx-auto w-full max-w-3xl">
        <header className="grid gap-4 border-b border-border pb-8">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <h1 className="display-lg text-fg">{title}</h1>
        </header>

        {paragraphs.length > 0 ? (
          <>
            <div className="grid gap-5 pt-8 text-base leading-relaxed text-fg-muted sm:text-lg">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line break-words text-pretty">
                  {paragraph}
                </p>
              ))}
            </div>
            <footer className="mt-10 grid gap-3 border-t border-border pt-6">
              <p className="text-sm text-fg-muted">{fill(copy.questions, { noun })}</p>
              <div>
                <ContactPath copy={copy} contactEmail={settings?.contactEmail ?? null} />
              </div>
            </footer>
          </>
        ) : result.status === "unavailable" ? (
          <div className="grid gap-4 pt-8">
            <Alert tone="warning" title={copy.unavailableTitle} description={copy.unavailableBody} />
            <div>
              <ContactPath copy={copy} contactEmail={null} />
            </div>
          </div>
        ) : (
          <div className="grid gap-5 pt-8">
            <div className="flex items-start gap-4 rounded-[22px] border border-border bg-surface p-5 shadow-card sm:p-6">
              <FileText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-accent-text" />
              <div className="grid gap-1.5">
                <h2 className="text-lg font-semibold text-fg">{copy.notPublishedTitle}</h2>
                <p className="text-fg-muted text-pretty">{fill(copy.notPublishedBody, { noun })}</p>
              </div>
            </div>
            <div>
              <ContactPath copy={copy} contactEmail={settings?.contactEmail ?? null} />
            </div>
          </div>
        )}
      </article>
    </Container>
  );
}
