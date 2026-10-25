import { ArrowRight, FileText, Mail } from "lucide-react";
import { Alert, ButtonLink } from "@/components/ui";
import { SECTION_IDS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { PublicSettingsResult } from "@/lib/data/public";
import { fill } from "@/lib/i18n/locale";
import { policyParagraphs } from "./policy-text";
import { Container, SectionLabel } from "./site/primitives";

export interface PolicyPageProps {
  copy: SiteCopy["policy"];
  /** Which text of the settings to show. */
  kind: "privacyPolicy" | "termsOfService";
  result: PublicSettingsResult;
}

function ContactPath({ copy, contactEmail }: { copy: SiteCopy["policy"]; contactEmail: string | null }) {
  if (contactEmail) {
    return (
      <ButtonLink href={`mailto:${contactEmail}`} variant="outline" className="rounded-full! border-fg/30!" icon={<Mail aria-hidden="true" />}>
        {fill(copy.emailUs, { email: contactEmail })}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={sectionHref(SECTION_IDS.trial)} variant="outline" className="rounded-full! border-fg/30!" iconRight={<ArrowRight aria-hidden="true" />}>
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
    <Container className="pt-36 pb-24 sm:pt-44 sm:pb-32">
      <article className="mx-auto w-full max-w-3xl">
        <header className="grid gap-6 border-b border-border pb-10">
          <SectionLabel>{copy.eyebrow}</SectionLabel>
          <h1 className="display-xl text-fg">{title}</h1>
        </header>

        {paragraphs.length > 0 ? (
          <>
            <div className="grid gap-5 pt-10 text-base leading-relaxed text-fg-muted sm:text-lg">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line break-words text-pretty">
                  {paragraph}
                </p>
              ))}
            </div>
            <footer className="mt-12 grid gap-4 border-t border-border pt-8">
              <p className="text-sm text-fg-muted">{fill(copy.questions, { noun })}</p>
              <div>
                <ContactPath copy={copy} contactEmail={settings?.contactEmail ?? null} />
              </div>
            </footer>
          </>
        ) : result.status === "unavailable" ? (
          <div className="grid gap-5 pt-10">
            <Alert tone="warning" title={copy.unavailableTitle} description={copy.unavailableBody} />
            <div>
              <ContactPath copy={copy} contactEmail={null} />
            </div>
          </div>
        ) : (
          <div className="grid gap-6 pt-10">
            <div className="flex items-start gap-4 rounded-[24px] border border-border bg-surface p-6 sm:p-8">
              <FileText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-accent-text" />
              <div className="grid gap-2">
                <h2 className="text-xl font-semibold text-fg">{copy.notPublishedTitle}</h2>
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
