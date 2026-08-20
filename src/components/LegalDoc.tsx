import type { LegalDocument } from '@/lib/legal/content';

export function LegalDoc({
  title,
  lastUpdated,
  doc,
}: {
  title: string;
  lastUpdated: string;
  doc: LegalDocument;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] text-ink-faint">{lastUpdated}</p>
      <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">{doc.intro}</p>

      <div className="mt-8 space-y-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-base font-semibold">{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p key={p} className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                {p}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-soft">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
