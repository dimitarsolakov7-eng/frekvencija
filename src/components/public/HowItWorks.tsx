import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER, SECTION_TITLE_CLASSES } from "./layout";

export const HOW_IT_WORKS_STEPS = [
  { title: "Choose a genre", description: "Find the right sound for your space." },
  { title: "Press play", description: "Start your station in one click." },
  { title: "Hear your name", description: "Your business name is announced on air." },
] as const;

/** "One login. Your own atmosphere." — three numbered steps (target of the header's "How it works"). */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4 py-16 sm:py-20">
      <div className={PUBLIC_CONTAINER}>
        <h2 id="how-it-works-title" className={SECTION_TITLE_CLASSES}>
          One login. Your own atmosphere.
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li
              key={step.title}
              className={cn("flex items-start gap-5 md:px-8", index === 0 && "md:pl-0", index > 0 && "md:border-l md:border-border")}
            >
              <span
                aria-hidden="true"
                className="grid size-16 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-xl font-bold text-accent-text"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="grid gap-1.5 pt-1.5">
                <h3 className="text-xl font-semibold text-fg">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="text-base text-fg-muted text-pretty">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
