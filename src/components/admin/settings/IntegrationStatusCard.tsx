import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleMinus, Info, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, StatusPill, type StatusPillTone } from "@/components/ui";
import type { IntegrationItem, IntegrationState } from "@/lib/data/admin/settings";
import { cn } from "@/lib/utils/cn";

const STATE_VIEW: Record<IntegrationState, { label: string; tone: StatusPillTone; icon: typeof CircleCheck; color: string }> = {
  ok: { label: "Working", tone: "success", icon: CircleCheck, color: "text-accent-text" },
  warning: { label: "Check", tone: "warning", icon: TriangleAlert, color: "text-warning" },
  error: { label: "Action needed", tone: "danger", icon: CircleAlert, color: "text-danger" },
  off: { label: "Not configured", tone: "neutral", icon: CircleMinus, color: "text-fg-muted" },
  info: { label: "Note", tone: "info", icon: Info, color: "text-info" },
};

function CardFrame({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle id="integration-status-heading">Integration status</CardTitle>
        <CardDescription>
          Read-only: these services are configured on the server (environment variables). Keys are never shown here.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Read-only status of Supabase, the secret key, the email-link address, ElevenLabs and email delivery. */
export function IntegrationStatusCard({ items }: { items: readonly IntegrationItem[] }) {
  return (
    <section aria-labelledby="integration-status-heading">
      <CardFrame>
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const view = STATE_VIEW[item.state];
            const Icon = view.icon;
            return (
              <li key={item.key} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", view.color)} />
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-fg">{item.name}</h3>
                    <StatusPill tone={view.tone} label={view.label} size="sm" />
                  </div>
                  <p className="text-sm text-fg-muted text-pretty">{item.summary}</p>
                  {item.details.length > 0 && (
                    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
                      {item.details.map((detail) => (
                        <div key={detail.label} className="contents">
                          <dt className="text-fg-muted">{detail.label}</dt>
                          <dd className="break-words text-fg">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {item.note && <p className="text-xs text-fg-subtle">{item.note}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardFrame>
    </section>
  );
}

/** Shown while the integration status (which may call ElevenLabs) loads. */
export function IntegrationStatusSkeleton() {
  return (
    <section aria-labelledby="integration-status-heading" aria-busy="true">
      <CardFrame>
        <p role="status" className="sr-only">
          Checking the integrations…
        </p>
        <div className="grid gap-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-start gap-3">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full max-w-md" />
              </div>
            </div>
          ))}
        </div>
      </CardFrame>
    </section>
  );
}
