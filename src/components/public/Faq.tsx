import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER } from "./layout";

/** The FAQ exactly as approved in design/CLAUDE-HANDOFF.md §01 (no invented claims). */
export const FAQ_ITEMS = [
  { question: "Can I change the music?", answer: "Choose another genre whenever you like." },
  {
    question: "Will my business name be announced?",
    answer: "Your station can play approved recordings with your business name between songs.",
  },
  {
    question: "Do I need special equipment?",
    answer:
      "Use a supported browser on a device connected to your venue’s sound system and an internet connection.",
  },
] as const;

/**
 * Accordion built on native <details>/<summary>: keyboard operable and announced as expandable
 * without any script. The first answer starts open, as in the design.
 */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-4 py-16 sm:py-20">
      <div className={PUBLIC_CONTAINER}>
        <h2 id="faq-title" className="text-2xl font-bold tracking-tight text-fg sm:text-[1.75rem]">
          Frequently asked questions
        </h2>
        <div className="mt-6 grid gap-3">
          {FAQ_ITEMS.map((item, index) => (
            <details
              key={item.question}
              open={index === 0}
              className="group rounded-card border border-border bg-surface open:bg-surface-2/60"
            >
              <summary
                className={cn(
                  "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-3.5",
                  "font-medium text-fg [&::-webkit-details-marker]:hidden",
                )}
              >
                <span>{item.question}</span>
                <Plus aria-hidden="true" className="size-5 shrink-0 text-fg-muted group-open:hidden" />
                <Minus aria-hidden="true" className="hidden size-5 shrink-0 text-fg-muted group-open:block" />
              </summary>
              <p className="px-5 pb-4 text-fg-muted text-pretty">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
