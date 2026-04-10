import Link from "next/link";

type LogoSize = "sm" | "md" | "lg" | "xl";

interface LogoProps {
  size?: LogoSize;
  wordmark?: boolean;
  href?: string;
  className?: string;
  eyebrow?: string;
  animate?: boolean;
}

const MARK_PX: Record<LogoSize, number> = {
  sm: 20,
  md: 24,
  lg: 28,
  xl: 34,
};

const TEXT_CLS: Record<LogoSize, string> = {
  sm: "text-[1.05rem]",
  md: "text-[1.2rem]",
  lg: "text-[1.4rem]",
  xl: "text-[1.6rem]",
};

export function Logo({
  size = "md",
  wordmark = true,
  href,
  className = "",
  eyebrow,
  animate = true,
}: LogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={MARK_PX[size]} animate={animate} />
      {wordmark && (
        <span
          className={`font-sans font-semibold ${TEXT_CLS[size]} text-ink leading-none tracking-[-0.035em] lowercase`}
        >
          talent<span className="text-cobalt">stream</span>
        </span>
      )}
      {eyebrow && (
        <span className="ml-1 eyebrow text-[0.58rem] text-ink-faint">
          {eyebrow}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="group inline-flex items-center" aria-label="TalentStream">
        {content}
      </Link>
    );
  }

  return content;
}

function LogoMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="TalentStream logo"
      className="shrink-0"
    >
      <title>TalentStream</title>
      {/* Funnel: four descending bars — the candidate pool narrowing to a shortlist. */}
      <rect x="3" y="5" width="26" height="3.2" rx="1.6" fill="currentColor" className="text-cobalt" />
      <rect x="3" y="11" width="20" height="3.2" rx="1.6" fill="currentColor" className="text-cobalt" opacity="0.82" />
      <rect x="3" y="17" width="13" height="3.2" rx="1.6" fill="currentColor" className="text-cobalt" opacity="0.62" />
      <rect x="3" y="23" width="7" height="3.2" rx="1.6" fill="currentColor" className="text-cobalt" opacity="0.42" />
      {/* The hire — a single vermillion signal beside the last bar. */}
      <circle
        cx="14"
        cy="24.6"
        r="2.1"
        fill="currentColor"
        className={`text-vermillion ${animate ? "pulse-dot" : ""}`}
        style={animate ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
      />
    </svg>
  );
}
