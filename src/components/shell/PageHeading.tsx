import { PageHeader, type PageHeaderProps } from "@/components/ui/PageHeader";

export type PageHeadingProps = PageHeaderProps;

/**
 * The page title block used inside <AppShell> (screens 03–08): optional breadcrumbs and eyebrow
 * ("Your station"), the page's single h1 (30px mobile, 36px tablet, 42px desktop), a one-line
 * description and right-aligned actions. Same component as `PageHeader` from `@/components/ui`.
 */
export function PageHeading(props: PageHeadingProps) {
  return <PageHeader {...props} />;
}
