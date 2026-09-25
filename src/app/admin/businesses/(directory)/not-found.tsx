import { BusinessNotFound } from "@/components/admin/businesses/DetailPlaceholders";

/** notFound() for a venue that doesn't exist: shown in the detail column, next to the list. */
export default function BusinessNotFoundPage() {
  return <BusinessNotFound basePath="/admin/businesses" />;
}
