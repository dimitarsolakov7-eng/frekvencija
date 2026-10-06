import type { Metadata } from "next";
import { isBusinessDetailTab } from "@/components/admin/businesses/detail-tabs";
import { BusinessesPreviewDetail } from "../BusinessesPreview";
import { parseListState } from "../fixtures";

export const metadata: Metadata = { title: "Businesses preview" };

// Reads the view from the URL on every request.
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page half of the screen-06 preview (see ../layout.tsx, which holds the list): the detail
 * column for /dev/preview/businesses[/<id>|/new], or the access requests for /requests (with
 * failed status changes for /requests?conflict=1).
 */
export default async function BusinessesPreviewPage({ params, searchParams }: PageProps<"/dev/preview/businesses/[[...slug]]">) {
  const { slug } = await params;
  const query = await searchParams;
  const tab = first(query.tab);

  return (
    <BusinessesPreviewDetail
      segment={slug?.[0] ?? ""}
      listState={parseListState(first(query.list))}
      tab={isBusinessDetailTab(tab) ? tab : "profile"}
      fromRequest={first(query.fromRequest) !== undefined}
      created={first(query.created) === "1"}
      conflict={first(query.conflict) === "1"}
    />
  );
}
