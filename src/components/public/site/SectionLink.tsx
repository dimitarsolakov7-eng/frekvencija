"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ButtonLink, type ButtonLinkProps } from "@/components/ui";
import { sectionHref, type SectionId } from "@/config/site";
import { useLenisRef } from "./motion/MotionProvider";
import { scrollToSection } from "./motion/scroll";

/**
 * Click handler for links to a homepage section: on the homepage it glides there (and moves focus);
 * from another page, or with a modifier key, the link navigates normally.
 */
export function useSectionClick(section: SectionId, before?: () => void) {
  const pathname = usePathname();
  const lenisRef = useLenisRef();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/" || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!document.getElementById(section)) return;
    event.preventDefault();
    if (before) {
      before();
      // Let a closing menu release the page before scrolling and moving focus.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => scrollToSection(section, lenisRef.current)));
    } else {
      scrollToSection(section, lenisRef.current);
    }
  };
}

export interface SectionLinkProps {
  section: SectionId;
  className?: string;
  children: ReactNode;
}

/** A text link to a homepage section. */
export function SectionLink({ section, className, children }: SectionLinkProps) {
  const onClick = useSectionClick(section);
  return (
    <Link href={sectionHref(section)} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}

export type SectionButtonLinkProps = Omit<ButtonLinkProps, "href" | "onClick"> & { section: SectionId };

/** A button-styled link to a homepage section. */
export function SectionButtonLink({ section, ...props }: SectionButtonLinkProps) {
  const onClick = useSectionClick(section);
  return <ButtonLink {...props} href={sectionHref(section)} onClick={onClick} />;
}
