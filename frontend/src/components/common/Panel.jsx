export default function Panel({
  title,
  meta,
  actions,
  children,
  className = '',
  bodyClassName = '',
}) {
  return (
    <section
      className={`rounded-2xl border border-dark-800/80 bg-dark-900 shadow-sm ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-dark-800/80">
          <div className="flex items-baseline gap-2.5 min-w-0">
            {title && (
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dark-400 truncate">
                {title}
              </h2>
            )}
            {meta && (
              <span className="text-[10px] font-mono text-dark-500 truncate">{meta}</span>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
