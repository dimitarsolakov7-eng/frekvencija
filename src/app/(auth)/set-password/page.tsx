import { permanentRedirect } from "next/navigation";

/**
 * Former password page. Links in older emails, bookmarks and other areas still point here, so it
 * permanently redirects (308) to /reset-password, which the proxy protects like this page used to be.
 */
export default function SetPasswordPage(): never {
  permanentRedirect("/reset-password");
}
