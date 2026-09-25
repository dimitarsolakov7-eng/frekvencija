import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";

/**
 * An icon given either as a component (`Music` from lucide-react) or as an element / node
 * (`<Music />`). Server Components must pass elements to Client Components (component functions
 * cannot cross the server→client boundary); shared shell components accept both and render the
 * component form themselves.
 */
export type IconLike = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }> | ReactNode;

function isComponentType(value: unknown): value is ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null || isValidElement(value) || Array.isArray(value)) return false;
  // forwardRef / memo exotic components (lucide-react icons are forwardRef objects).
  const exotic = value as { $$typeof?: unknown; render?: unknown; type?: unknown };
  return typeof exotic.$$typeof === "symbol" && (typeof exotic.render === "function" || exotic.type !== undefined);
}

/** Renders an IconLike, hiding a component icon from assistive technology. */
export function renderIcon(icon: IconLike | undefined, className?: string): ReactNode {
  if (icon === undefined || icon === null || icon === false) return null;
  if (isComponentType(icon)) return createElement(icon, { className, "aria-hidden": true });
  return icon as ReactNode;
}
