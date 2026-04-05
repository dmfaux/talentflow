"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────
   HOOKS
   ───────────────────────────────────────────── */

function useScrollAnimation() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    const targets = el.querySelectorAll(".animate-on-scroll");
    targets.forEach((t) => observer.observe(t));

    return () => observer.disconnect();
  }, []);

  return ref;
}

function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const total = h.scrollHeight - h.clientHeight;
      setP(total > 0 ? (h.scrollTop / total) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return p;
}

function useCountUp(target: number, durationMs = 1400, trigger = true) {
  const [n, setN] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!trigger || startedRef.current) return;
    startedRef.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * target));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, trigger]);

  return n;
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setInView(true),
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView] as const;
}

/* ─────────────────────────────────────────────
   NAVIGATION
   ───────────────────────────────────────────── */

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const progress = useScrollProgress();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-canvas/92 backdrop-blur-md border-b border-rule"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="mx-auto max-w-[1240px] px-6 sm:px-10 flex items-center justify-between h-16 sm:h-[68px]">
          <a href="#" className="flex items-center gap-2.5 group">
            <span className="relative w-2 h-2 rounded-full bg-vermillion pulse-dot" aria-hidden />
            <span className="font-display text-[1.35rem] sm:text-[1.5rem] text-ink tracking-[-0.02em] leading-none">
              Talent<span className="font-display-italic text-cobalt">Stream</span>
            </span>
          </a>

          <div className="hidden md:flex items-center gap-10">
            <a href="#method" className="text-[0.82rem] font-medium text-ink-muted hover:text-ink link-underline transition-colors">
              Method
            </a>
            <a href="#why" className="text-[0.82rem] font-medium text-ink-muted hover:text-ink link-underline transition-colors">
              Why us
            </a>
            <a href="#pricing" className="text-[0.82rem] font-medium text-ink-muted hover:text-ink link-underline transition-colors">
              Pricing
            </a>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <a
              href="/login"
              className="text-[0.82rem] font-medium text-ink-muted hover:text-ink transition-colors"
            >
              Log in
            </a>
            <a
              href="#start"
              className="arrow-parent group hidden sm:inline-flex items-center gap-2 h-10 px-[18px] bg-ink text-canvas text-[0.82rem] font-medium rounded-full hover:bg-cobalt transition-colors duration-300 lift"
            >
              Start a campaign
              <span className="arrow-slide">→</span>
            </a>
          </div>
        </div>
        {/* scroll progress line */}
        <div className="absolute bottom-0 left-0 h-[2px] bg-cobalt transition-[width] duration-75" style={{ width: `${progress}%` }} />
      </nav>
    </>
  );
}

/* ─────────────────────────────────────────────
   HERO
   ───────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative pt-32 sm:pt-40 pb-16 sm:pb-20 overflow-hidden">
      {/* Subtle radial wash */}
      <div
        className="pointer-events-none absolute inset-0 hero-grid"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 80% 20%, rgba(28, 53, 240, 0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 10% 80%, rgba(230, 57, 23, 0.05) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-[1240px] px-6 sm:px-10">
        {/* Eyebrow tag */}
        <div className="load-fade load-1 flex items-center gap-3 mb-8 sm:mb-10">
          <span className="inline-block w-6 h-px bg-vermillion" aria-hidden />
          <span className="eyebrow text-vermillion">
            Recruitment · rebuilt for South Africa · est. 2026
          </span>
        </div>

        {/* Main headline — editorial grid */}
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-end">
          <div className="lg:col-span-8">
            <h1 className="font-display text-ink text-[2.75rem] sm:text-[4rem] lg:text-[5.25rem] leading-[0.96] tracking-[-0.025em]">
              <span className="load-reveal load-1 block">A shortlist,</span>
              <span className="load-reveal load-2 block">not a <span className="font-display-italic text-vermillion">headache</span>.</span>
            </h1>
            <p className="load-fade load-3 mt-8 sm:mt-10 text-ink-soft text-[1.05rem] sm:text-[1.18rem] leading-[1.55] max-w-[560px]">
              We run AI-powered hiring campaigns for South African corporates. You give us the role spec. We deliver a rated, qualified shortlist — in two weeks, for a flat fee.
            </p>
            <div className="load-fade load-4 mt-10 sm:mt-12 flex flex-wrap items-center gap-3 sm:gap-4">
              <a
                href="#start"
                className="arrow-parent group inline-flex items-center gap-2.5 h-[52px] px-7 bg-cobalt text-white text-[0.95rem] font-medium rounded-full hover:bg-cobalt-deep transition-colors duration-300 lift shadow-[0_8px_24px_-8px_rgba(28,53,240,0.35)]"
              >
                Start a campaign
                <span className="arrow-slide">→</span>
              </a>
              <a
                href="#method"
                className="inline-flex items-center gap-2.5 h-[52px] px-7 border border-ink/15 text-ink text-[0.95rem] font-medium rounded-full hover:bg-ink hover:text-canvas transition-colors duration-300"
              >
                See the method
              </a>
            </div>
          </div>

          {/* Right col — stat card */}
          <div className="load-fade load-5 lg:col-span-4 lg:pl-6">
            <HeroStat />
          </div>
        </div>
      </div>

      {/* Live ticker strip */}
      <div className="load-fade load-6 relative mt-20 sm:mt-28">
        <LiveTicker />
      </div>
    </section>
  );
}

function HeroStat() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const weeks = useCountUp(2, 1200, inView);
  const savings = useCountUp(58, 1600, inView);
  const speed = useCountUp(12, 1400, inView);

  return (
    <div
      ref={ref}
      className="relative border border-ink/10 bg-paper rounded-2xl p-6 sm:p-7"
    >
      <div className="absolute -top-[1px] -right-[1px] w-16 h-16 pointer-events-none" aria-hidden>
        <div className="absolute top-0 right-0 w-full h-full border-t-2 border-r-2 border-vermillion rounded-tr-2xl" />
      </div>
      <div className="flex items-center gap-2">
        <span className="relative w-1.5 h-1.5 rounded-full bg-moss pulse-dot" aria-hidden />
        <span className="eyebrow text-ink-muted text-[0.64rem]">Campaign metrics · live</span>
      </div>
      <dl className="mt-6 space-y-5">
        <div className="flex items-baseline justify-between border-b border-rule pb-4">
          <dt className="text-[0.82rem] text-ink-muted">Time to shortlist</dt>
          <dd className="font-mono text-[1.5rem] text-ink font-medium tracking-tight">
            {weeks}<span className="text-ink-muted ml-1 text-sm font-normal">weeks</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-b border-rule pb-4">
          <dt className="text-[0.82rem] text-ink-muted">Cost savings</dt>
          <dd className="font-mono text-[1.5rem] text-moss font-medium tracking-tight">
            {savings}<span className="text-ink-muted ml-0.5 text-sm font-normal">%</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-[0.82rem] text-ink-muted">Candidates scored / hour</dt>
          <dd className="font-mono text-[1.5rem] text-cobalt font-medium tracking-tight">
            {speed}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LiveTicker() {
  const items = [
    { label: "Gating passed", value: "+47", tone: "moss" as const },
    { label: "Scored", value: "+89", tone: "cobalt" as const },
    { label: "Shortlisted", value: "+14", tone: "moss" as const },
    { label: "Follow-up sent", value: "+22", tone: "saffron" as const },
    { label: "Applied today", value: "+312", tone: "ink" as const },
    { label: "Confidence ≥ 80%", value: "+18", tone: "cobalt" as const },
    { label: "POPIA consent", value: "100%", tone: "moss" as const },
    { label: "Active campaigns", value: "11", tone: "vermillion" as const },
  ];
  const toneClass = {
    moss: "text-moss",
    cobalt: "text-cobalt",
    saffron: "text-saffron-deep",
    vermillion: "text-vermillion",
    ink: "text-ink",
  };
  return (
    <div className="relative border-y border-rule bg-paper/60 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10"
        style={{ background: "linear-gradient(to right, var(--color-canvas), transparent)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10"
        style={{ background: "linear-gradient(to left, var(--color-canvas), transparent)" }}
        aria-hidden
      />
      <div className="ticker-track flex gap-10 py-4 whitespace-nowrap">
        {[...items, ...items].map((it, i) => (
          <div key={i} className="flex items-center gap-3 shrink-0">
            <span className="eyebrow text-[0.62rem] text-ink-muted">{it.label}</span>
            <span className={`font-mono text-[0.88rem] font-medium ${toneClass[it.tone]}`}>
              {it.value}
            </span>
            <span className="text-ink-faint">·</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   PROBLEM (editorial callout)
   ───────────────────────────────────────────── */

function Problem() {
  const ref = useScrollAnimation();

  const pains = [
    {
      num: "01",
      title: "Agencies charge 15–25% of salary for CV forwarding",
      body: "You're paying a premium for a commodity. Most agencies just search portals and forward unscreened résumés.",
      tone: "vermillion" as const,
    },
    {
      num: "02",
      title: "Internal hiring burns your team out",
      body: "HR drowns in unqualified applications. Every open role becomes a second full-time job for someone.",
      tone: "saffron" as const,
    },
    {
      num: "03",
      title: "Contingency fees reward speed over quality",
      body: "The agency gets paid on placement, not performance. The incentives are pointing in the wrong direction.",
      tone: "cobalt" as const,
    },
  ];

  const toneBar = {
    vermillion: "bg-vermillion",
    saffron: "bg-saffron",
    cobalt: "bg-cobalt",
  };
  const toneText = {
    vermillion: "text-vermillion",
    saffron: "text-saffron-deep",
    cobalt: "text-cobalt",
  };

  return (
    <section ref={ref} className="py-24 sm:py-32 border-t border-rule bg-canvas">
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 mb-16 sm:mb-20">
          <div className="lg:col-span-5 lg:sticky lg:top-28 lg:self-start">
            <div className="animate-on-scroll flex items-center gap-3 mb-5">
              <span className="inline-block w-5 h-px bg-ink" aria-hidden />
              <span className="eyebrow text-ink-muted">The problem</span>
            </div>
            <h2 className="animate-on-scroll stagger-1 font-display text-ink text-[2.25rem] sm:text-[2.75rem] lg:text-[3.25rem] tracking-[-0.02em] leading-[1.02]">
              Traditional recruitment is <span className="font-display-italic text-vermillion">broken</span>.
            </h2>
            <p className="animate-on-scroll stagger-2 mt-6 text-ink-muted text-[0.98rem] leading-[1.6] max-w-md">
              Three structural problems — and why the SaaS-plus-service model we built fixes all of them.
            </p>
          </div>

          <div className="lg:col-span-7 space-y-px">
            {pains.map((p, i) => (
              <div
                key={i}
                className={`animate-on-scroll stagger-${i + 2} group relative bg-paper border border-rule p-7 sm:p-8 transition-colors hover:bg-canvas-2 ${
                  i === 0 ? "rounded-t-2xl" : ""
                } ${i === pains.length - 1 ? "rounded-b-2xl" : ""}`}
              >
                <div className="flex items-start gap-5 sm:gap-7">
                  <div className={`shrink-0 w-1 h-12 ${toneBar[p.tone]}`} aria-hidden />
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-4 mb-2.5">
                      <h3 className="font-display text-ink text-[1.25rem] sm:text-[1.35rem] leading-[1.2] tracking-[-0.01em] max-w-[420px]">
                        {p.title}
                      </h3>
                      <span className={`font-mono text-[0.72rem] ${toneText[p.tone]} shrink-0`}>
                        {p.num}
                      </span>
                    </div>
                    <p className="text-ink-muted text-[0.92rem] leading-[1.6]">
                      {p.body}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   METHOD (How it works)
   ───────────────────────────────────────────── */

function Method() {
  const ref = useScrollAnimation();

  const steps = [
    {
      num: "01",
      title: "You brief us",
      body: "Share your role spec, must-haves, and dealbreakers. We configure a branded campaign in under an hour.",
      tag: "Day 0",
    },
    {
      num: "02",
      title: "Candidates apply",
      body: "We drive qualified applicants to a branded landing page with smart screening that filters mismatches instantly.",
      tag: "Days 1–7",
    },
    {
      num: "03",
      title: "AI evaluates",
      body: "Every CV parsed and scored by AI against your specific criteria. Ambiguities resolved via WhatsApp follow-ups.",
      tag: "Days 7–12",
    },
    {
      num: "04",
      title: "You get a shortlist",
      body: "A rated, ranked shortlist with confidence scores and plain-language rationale for every candidate.",
      tag: "Day 14",
    },
  ];

  return (
    <section ref={ref} id="method" className="relative py-24 sm:py-32 bg-paper border-t border-rule scroll-mt-20">
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="animate-on-scroll flex items-center gap-3 mb-5">
          <span className="inline-block w-5 h-px bg-cobalt" aria-hidden />
          <span className="eyebrow text-cobalt">The method</span>
        </div>
        <h2 className="animate-on-scroll stagger-1 font-display text-ink text-[2.25rem] sm:text-[2.75rem] lg:text-[3.25rem] tracking-[-0.02em] leading-[1.02] max-w-[820px]">
          From role spec to shortlist in <span className="font-display-italic text-cobalt">four&nbsp;steps</span>.
        </h2>

        <div className="mt-14 sm:mt-20 grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-rule border border-rule rounded-2xl overflow-hidden">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${i + 2} group relative bg-paper p-7 sm:p-8 transition-colors hover:bg-canvas`}
            >
              <div className="flex items-start justify-between mb-8">
                <span className="font-mono text-[0.7rem] text-ink-faint">{s.tag}</span>
                <span className="font-mono text-[2.5rem] text-cobalt leading-none font-medium tabular-nums">
                  {s.num}
                </span>
              </div>
              <h3 className="font-display text-ink text-[1.35rem] leading-[1.15] tracking-[-0.01em] mb-3">
                {s.title}
              </h3>
              <p className="text-ink-muted text-[0.9rem] leading-[1.55]">
                {s.body}
              </p>
              <div className="absolute bottom-0 left-0 h-[2px] bg-cobalt w-0 group-hover:w-full transition-[width] duration-500" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   BENEFITS
   ───────────────────────────────────────────── */

function Benefits() {
  const ref = useScrollAnimation();

  const items = [
    {
      title: "Fraction of the cost",
      body: "A flat campaign fee — not a percentage of salary. Save 40–60% compared to traditional agencies.",
      tone: "cobalt" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 010 7H6" />
        </svg>
      ),
    },
    {
      title: "Speed",
      body: "From live campaign to shortlist in two to three weeks. No drawn-out search timelines.",
      tone: "vermillion" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L4.5 13.5H12l-1 8.5 8.5-11.5H12z" />
        </svg>
      ),
    },
    {
      title: "AI-scored, human-reviewed",
      body: "Every candidate assessed by AI and quality-checked by our team. No black-box decisions.",
      tone: "moss" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
    {
      title: "POPIA compliant by design",
      body: "Candidate data hosted in South Africa on Azure. Consent, retention, and audit trails built in.",
      tone: "cobalt" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
    {
      title: "Transparent rationale",
      body: "Every score comes with a plain-language explanation. You see exactly why each candidate made the list.",
      tone: "saffron" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h0" />
        </svg>
      ),
    },
    {
      title: "BEE reporting ready",
      body: "Shortlist demographics captured and reported to support your transformation objectives.",
      tone: "vermillion" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l3-9 4 18 3-9h4" />
        </svg>
      ),
    },
  ];

  const toneText = {
    cobalt: "text-cobalt",
    vermillion: "text-vermillion",
    moss: "text-moss",
    saffron: "text-saffron-deep",
  };
  const toneBg = {
    cobalt: "bg-cobalt-tint",
    vermillion: "bg-vermillion-soft",
    moss: "bg-moss-soft",
    saffron: "bg-saffron-soft",
  };

  return (
    <section ref={ref} id="why" className="py-24 sm:py-32 bg-canvas border-t border-rule scroll-mt-20">
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="flex items-end justify-between mb-14 sm:mb-16 flex-wrap gap-6">
          <div>
            <div className="animate-on-scroll flex items-center gap-3 mb-5">
              <span className="inline-block w-5 h-px bg-moss" aria-hidden />
              <span className="eyebrow text-moss">Why TalentStream</span>
            </div>
            <h2 className="animate-on-scroll stagger-1 font-display text-ink text-[2.25rem] sm:text-[2.75rem] lg:text-[3.25rem] tracking-[-0.02em] leading-[1.02] max-w-[760px]">
              Built for the way South African teams <span className="font-display-italic">actually&nbsp;hire</span>.
            </h2>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${(i % 3) + 2} group relative bg-paper border border-rule rounded-2xl p-7 transition-all lift hover:border-ink/20`}
            >
              <div className={`w-10 h-10 rounded-lg ${toneBg[item.tone]} flex items-center justify-center ${toneText[item.tone]} mb-6`}>
                <div className="w-5 h-5">{item.icon}</div>
              </div>
              <h3 className="font-display text-ink text-[1.2rem] leading-[1.2] tracking-[-0.01em] mb-2.5">
                {item.title}
              </h3>
              <p className="text-ink-muted text-[0.9rem] leading-[1.55]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   STATS (bold editorial numbers)
   ───────────────────────────────────────────── */

function Stats() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const stats = [
    { value: useCountUp(14, 1400, inView), suffix: " days", label: "Avg. time to shortlist", tone: "cobalt" as const },
    { value: useCountUp(58, 1700, inView), suffix: "%", label: "Savings vs. traditional agencies", tone: "moss" as const },
    { value: useCountUp(12, 1300, inView), suffix: "/hr", label: "Candidates scored by AI", tone: "vermillion" as const },
    { value: useCountUp(100, 1600, inView), suffix: "%", label: "POPIA compliant, ZA-hosted", tone: "cobalt" as const },
  ];
  const toneText = {
    cobalt: "text-cobalt",
    moss: "text-moss",
    vermillion: "text-vermillion",
  };

  return (
    <section ref={ref} className="py-20 sm:py-28 bg-ink text-canvas relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="flex items-center gap-3 mb-10 sm:mb-14">
          <span className="inline-block w-5 h-px bg-vermillion" aria-hidden />
          <span className="eyebrow text-vermillion">By the numbers</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
          {stats.map((s, i) => (
            <div key={i} className="border-l border-canvas/15 pl-5 sm:pl-6">
              <p className={`font-display text-[3rem] sm:text-[4rem] lg:text-[4.75rem] leading-[0.95] tracking-[-0.03em] font-medium tabular-nums ${toneText[s.tone]}`}>
                {s.value}
                <span className="text-canvas/70 text-[0.35em] ml-1 font-sans font-normal align-super">{s.suffix}</span>
              </p>
              <p className="mt-4 text-canvas/60 text-[0.85rem] leading-[1.4] max-w-[180px]">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   PRICING
   ───────────────────────────────────────────── */

function Pricing() {
  const ref = useScrollAnimation();

  const tiers = [
    {
      name: "Standard",
      price: "R25,000",
      priceRange: "– R35,000",
      desc: "Roles up to R500k CTC",
      features: [
        "Branded campaign page",
        "3–5 gating questions",
        "AI scoring & rationale",
        "WhatsApp follow-ups",
        "Up to 10 candidates shortlisted",
      ],
      featured: false,
    },
    {
      name: "Senior",
      price: "R40,000",
      priceRange: "– R55,000",
      desc: "Roles R500k – R800k CTC",
      features: [
        "Everything in Standard",
        "Extended campaign duration",
        "Deeper scoring rubric",
        "Priority support",
        "Bespoke BEE reporting",
      ],
      featured: true,
    },
    {
      name: "Executive",
      price: "R60,000",
      priceRange: "– R80,000",
      desc: "Roles above R800k CTC",
      features: [
        "Everything in Senior",
        "Dedicated campaign manager",
        "Enhanced BEE reporting",
        "90-day replacement guarantee",
        "Director-level briefings",
      ],
      featured: false,
    },
  ];

  return (
    <section ref={ref} id="pricing" className="py-24 sm:py-32 bg-canvas border-t border-rule scroll-mt-20">
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="max-w-[720px]">
          <div className="animate-on-scroll flex items-center gap-3 mb-5">
            <span className="inline-block w-5 h-px bg-vermillion" aria-hidden />
            <span className="eyebrow text-vermillion">Pricing</span>
          </div>
          <h2 className="animate-on-scroll stagger-1 font-display text-ink text-[2.25rem] sm:text-[2.75rem] lg:text-[3.25rem] tracking-[-0.02em] leading-[1.02]">
            Flat fees. No <span className="font-display-italic">placement</span> fees.
          </h2>
          <p className="animate-on-scroll stagger-2 mt-6 text-ink-muted text-[1rem] leading-[1.6] max-w-[520px]">
            One campaign price, paid upfront. Ad spend passed through at cost. No kickbacks, no percentages, no surprises.
          </p>
        </div>

        <div className="mt-14 sm:mt-16 grid md:grid-cols-3 gap-4">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${i + 3} relative rounded-2xl p-7 sm:p-8 transition-all lift ${
                tier.featured
                  ? "bg-ink text-canvas border border-ink shadow-[0_12px_48px_-12px_rgba(11,15,28,0.3)]"
                  : "bg-paper text-ink border border-rule hover:border-ink/20"
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-3 left-8">
                  <span className="inline-flex items-center gap-1.5 bg-vermillion text-white text-[0.66rem] font-semibold uppercase tracking-[0.12em] px-3 py-1.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-white pulse-dot" />
                    Most chosen
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <h3 className={`font-display text-[1.35rem] tracking-[-0.01em] ${tier.featured ? "text-canvas" : "text-ink"}`}>
                  {tier.name}
                </h3>
              </div>
              <p className={`mt-2 text-[0.82rem] ${tier.featured ? "text-canvas/55" : "text-ink-faint"}`}>
                {tier.desc}
              </p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className={`font-mono text-[1.75rem] font-medium tracking-tight tabular-nums ${tier.featured ? "text-canvas" : "text-ink"}`}>
                  {tier.price}
                </span>
                <span className={`font-mono text-[0.85rem] ${tier.featured ? "text-canvas/55" : "text-ink-faint"}`}>
                  {tier.priceRange}
                </span>
              </div>
              <div className={`my-7 h-px ${tier.featured ? "bg-canvas/15" : "bg-rule"}`} />
              <ul className="space-y-3.5">
                {tier.features.map((f, j) => (
                  <li key={j} className={`flex items-start gap-3 text-[0.88rem] leading-[1.45] ${tier.featured ? "text-canvas/80" : "text-ink-soft"}`}>
                    <svg
                      viewBox="0 0 16 16"
                      className={`shrink-0 mt-[3px] w-[14px] h-[14px] ${
                        tier.featured ? "text-vermillion" : "text-cobalt"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 8.5L6.5 12l7-8" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="#start"
                className={`mt-8 inline-flex w-full items-center justify-center h-11 rounded-full text-[0.85rem] font-medium transition-colors ${
                  tier.featured
                    ? "bg-vermillion text-white hover:bg-vermillion-deep"
                    : "bg-ink text-canvas hover:bg-cobalt"
                }`}
              >
                Choose {tier.name}
              </a>
            </div>
          ))}
        </div>
        <p className="animate-on-scroll mt-8 font-mono text-[0.72rem] text-ink-faint text-center tracking-wide">
          AD SPEND PASSED THROUGH AT COST · ALL PRICES EXCLUDE VAT
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   FINAL CTA
   ───────────────────────────────────────────── */

function FinalCTA() {
  const ref = useScrollAnimation();
  const [email, setEmail] = useState("");

  return (
    <section ref={ref} id="start" className="py-24 sm:py-36 bg-paper border-t border-rule relative overflow-hidden scroll-mt-20">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(28, 53, 240, 0.04) 0%, transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1240px] px-6 sm:px-10">
        <div className="max-w-[820px] mx-auto text-center">
          <div className="animate-on-scroll inline-flex items-center gap-2 mb-8 px-4 py-2 border border-rule rounded-full bg-canvas">
            <span className="w-1.5 h-1.5 rounded-full bg-moss pulse-dot" />
            <span className="eyebrow text-[0.66rem] text-ink-muted">Currently onboarding founding clients</span>
          </div>
          <h2 className="animate-on-scroll stagger-1 font-display text-ink text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem] tracking-[-0.025em] leading-[1.0]">
            Tell us about the role.
            <br />
            <span className="font-display-italic text-cobalt">We&rsquo;ll do the rest.</span>
          </h2>
          <p className="animate-on-scroll stagger-2 mt-8 text-ink-muted text-[1.05rem] sm:text-[1.15rem] leading-[1.55] max-w-[520px] mx-auto">
            We&rsquo;ll have your campaign live within 24 hours of the brief. Shortlist in your inbox, in two weeks.
          </p>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="animate-on-scroll stagger-3 mt-12 flex flex-col sm:flex-row items-stretch gap-3 max-w-[520px] mx-auto"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-[56px] w-full flex-1 px-5 rounded-full bg-canvas border border-rule text-ink placeholder:text-ink-faint text-[0.95rem] outline-none transition-all duration-200 focus:border-cobalt focus:ring-2 focus:ring-cobalt/20"
            />
            <button
              type="submit"
              className="arrow-parent group h-[56px] px-7 bg-cobalt text-white font-medium text-[0.95rem] rounded-full hover:bg-cobalt-deep transition-colors duration-300 shrink-0 inline-flex items-center justify-center gap-2.5 lift shadow-[0_8px_24px_-8px_rgba(28,53,240,0.35)]"
            >
              Start a campaign
              <span className="arrow-slide">→</span>
            </button>
          </form>
          <p className="animate-on-scroll stagger-4 mt-6 text-[0.82rem] text-ink-faint">
            Or email{" "}
            <a href="mailto:hello@talentstream.co.za" className="text-ink link-underline font-medium">
              hello@talentstream.co.za
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   FOOTER
   ───────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="bg-canvas border-t border-rule">
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10 py-14">
        <div className="grid sm:grid-cols-12 gap-10 mb-14">
          <div className="sm:col-span-5">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-vermillion" />
              <span className="font-display text-[1.4rem] text-ink tracking-[-0.02em] leading-none">
                Talent<span className="font-display-italic text-cobalt">Stream</span>
              </span>
            </div>
            <p className="mt-4 text-[0.88rem] text-ink-muted leading-[1.55] max-w-[380px]">
              AI-powered recruitment campaigns. Built for South African corporates. Hosted in South Africa, on Azure.
            </p>
          </div>
          <div className="sm:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
            <div>
              <p className="eyebrow text-ink-faint mb-4">Product</p>
              <ul className="space-y-2.5">
                <li><a href="#method" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Method</a></li>
                <li><a href="#why" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Why us</a></li>
                <li><a href="#pricing" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow text-ink-faint mb-4">Company</p>
              <ul className="space-y-2.5">
                <li><a href="/login" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Log in</a></li>
                <li><a href="mailto:hello@talentstream.co.za" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow text-ink-faint mb-4">Legal</p>
              <ul className="space-y-2.5">
                <li><a href="#" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Privacy</a></li>
                <li><a href="#" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">POPIA</a></li>
                <li><a href="#" className="text-[0.88rem] text-ink-soft hover:text-cobalt link-underline transition-colors">Terms</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="pt-8 border-t border-rule flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="font-mono text-[0.72rem] text-ink-faint tracking-wide">
            © 2026 TALENTSTREAM (PTY) LTD · ALL RIGHTS RESERVED
          </p>
          <p className="font-mono text-[0.72rem] text-ink-faint tracking-wide">
            HOSTED ON AZURE SOUTH AFRICA
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────── */

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="bg-canvas">
        <Hero />
        <Problem />
        <Method />
        <Benefits />
        <Stats />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
