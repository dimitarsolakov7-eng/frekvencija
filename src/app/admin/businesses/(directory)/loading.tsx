import { BusinessDetailSkeleton } from "@/components/admin/businesses/DetailPlaceholders";

/** Shown in the detail column while a venue (or the add form) loads; the list stays usable. */
export default function BusinessDetailLoading() {
  return <BusinessDetailSkeleton />;
}
