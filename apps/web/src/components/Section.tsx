export function Section({
  index,
  title,
  subtitle,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle pt-6 first:border-t-0 first:pt-0">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-baseline gap-2.5">
          <span className="text-muted-dim tabular-nums">{String(index).padStart(2, '0')}</span>
          <span className="text-[15px] font-semibold tracking-wide text-foreground uppercase">
            {title}
          </span>
        </h2>
        {subtitle !== undefined && <p className="text-muted">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
