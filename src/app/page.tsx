"use client";

import { useEffect, useRef, useState } from "react";

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

/* ─── Navigation ─── */
function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-cream/95 backdrop-blur-md border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8 flex items-center justify-between h-16 sm:h-[72px]">
        <a href="#" className="font-serif italic text-xl sm:text-2xl text-txt-primary tracking-tight">
          TalentStream
        </a>
        <div className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="text-sm font-sans text-txt-secondary hover:text-txt-primary transition-colors">
            How It Works
          </a>
          <a href="#pricing" className="text-sm font-sans text-txt-secondary hover:text-txt-primary transition-colors">
            Pricing
          </a>
          <a href="#about" className="text-sm font-sans text-txt-secondary hover:text-txt-primary transition-colors">
            About
          </a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/login"
            className="text-sm font-sans text-txt-secondary hover:text-txt-primary transition-colors"
          >
            Log in
          </a>
          <a
            href="#get-started"
            className="hidden sm:inline-flex items-center justify-center h-10 px-5 bg-accent text-white text-sm font-sans font-medium rounded-lg hover:bg-accent-light transition-colors"
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ─── Hero ─── */
function Hero() {
  return (
    <section className="relative pt-36 sm:pt-44 pb-24 sm:pb-32 hero-grid overflow-hidden">
      {/* Soft radial wash for depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 30%, rgba(27,67,50,0.04) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-[1200px] px-6 sm:px-8">
        <h1 className="font-serif text-txt-primary text-[2.5rem] sm:text-[3.5rem] lg:text-[4.25rem] leading-[1.1] tracking-tight max-w-[820px]">
          Recruitment campaigns that deliver a shortlist, not a headache
        </h1>
        <p className="mt-6 sm:mt-8 font-sans text-txt-secondary text-lg sm:text-xl leading-relaxed max-w-[600px]">
          We run AI-powered hiring campaigns for South African corporates. You give us the role spec. We give you rated, qualified candidates in two&nbsp;weeks.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="#get-started"
            className="inline-flex items-center justify-center h-12 px-7 bg-accent text-white text-sm sm:text-base font-sans font-medium rounded-lg hover:bg-accent-light transition-colors"
          >
            Start a Campaign
          </a>
          <a
            href="#how-it-works"
            className="inline-flex items-center justify-center h-12 px-7 border border-accent text-accent text-sm sm:text-base font-sans font-medium rounded-lg hover:bg-accent/5 transition-colors"
          >
            See How It Works
          </a>
        </div>
        <p className="mt-10 font-sans text-sm text-txt-muted tracking-wide">
          Trusted by hiring teams at leading South African corporates
        </p>
      </div>
    </section>
  );
}

/* ─── Problem Statement ─── */
function ProblemStatement() {
  const ref = useScrollAnimation();

  const pains = [
    {
      title: "Agencies charge 15–25% of salary for CV forwarding",
      body: "Most agencies just search portals and send unscreened CVs. You're paying a premium for a commodity service.",
    },
    {
      title: "Internal hiring takes months and burns your team out",
      body: "HR teams drown in unqualified applications. Every open role becomes a second full-time job for someone.",
    },
    {
      title: "You pay whether the hire works out or not",
      body: "Contingency models incentivise speed over quality. The agency gets paid on placement, not on performance.",
    },
  ];

  return (
    <section ref={ref} className="py-24 sm:py-32 bg-cream">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <h2 className="animate-on-scroll font-serif text-txt-primary text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight">
          Traditional recruitment is broken
        </h2>
        <div className="mt-12 sm:mt-16 grid sm:grid-cols-3 gap-6">
          {pains.map((p, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${i + 1} bg-surface border border-border rounded-xl p-6 sm:p-8 relative overflow-hidden`}
            >
              {/* Geometric accent — a thin diagonal line in the top corner */}
              <div className="absolute top-0 right-0 w-16 h-16">
                <div className="absolute top-0 right-0 w-px h-20 bg-gold/30 origin-top-right rotate-[-35deg] translate-x-6" />
              </div>
              <div className="w-8 h-px bg-gold mb-5" />
              <h3 className="font-sans font-semibold text-txt-primary text-base leading-snug">
                {p.title}
              </h3>
              <p className="mt-3 font-sans text-sm text-txt-secondary leading-relaxed">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How It Works ─── */
function HowItWorks() {
  const ref = useScrollAnimation();

  const steps = [
    {
      num: "01",
      title: "You brief us",
      body: "Share your role spec, must-haves, and dealbreakers. We configure a branded campaign in under an hour.",
    },
    {
      num: "02",
      title: "Candidates apply",
      body: "We drive qualified applicants to a branded landing page with smart screening questions that filter out mismatches instantly.",
    },
    {
      num: "03",
      title: "AI evaluates",
      body: "Every CV is parsed and scored by AI against your specific criteria. Ambiguities are resolved via WhatsApp follow-ups.",
    },
    {
      num: "04",
      title: "You get a shortlist",
      body: "A rated, ranked shortlist with confidence scores and plain-language rationale for every candidate. Ready for interviews.",
    },
  ];

  return (
    <section ref={ref} id="how-it-works" className="py-24 sm:py-32 bg-surface scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <h2 className="animate-on-scroll font-serif text-txt-primary text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight">
          From role spec to shortlist in four&nbsp;steps
        </h2>
        <div className="mt-14 sm:mt-20 relative">
          {/* Connecting line */}
          <div className="hidden sm:block absolute left-[23px] top-2 bottom-2 w-px bg-border" />
          <div className="space-y-10 sm:space-y-14">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`animate-on-scroll stagger-${i + 1} flex gap-6 sm:gap-10 items-start relative`}
              >
                {/* Step number with dot on the connecting line */}
                <div className="flex-shrink-0 relative z-10">
                  <div className="w-[46px] h-[46px] rounded-full bg-cream border border-border flex items-center justify-center">
                    <span className="font-mono text-sm font-medium text-gold">{s.num}</span>
                  </div>
                </div>
                <div className="pt-2">
                  <h3 className="font-sans font-semibold text-txt-primary text-lg">
                    {s.title}
                  </h3>
                  <p className="mt-2 font-sans text-txt-secondary text-base leading-relaxed max-w-lg">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Benefits ─── */
function Benefits() {
  const ref = useScrollAnimation();

  const items = [
    {
      title: "Fraction of the cost",
      body: "A flat campaign fee, not a percentage of salary. Save 40–60% compared to traditional agencies.",
    },
    {
      title: "Speed",
      body: "From live campaign to shortlist in two to three weeks. No drawn-out search timelines.",
    },
    {
      title: "AI-scored, human-reviewed",
      body: "Every candidate is assessed by AI and quality-checked by our team. No black-box decisions.",
    },
    {
      title: "POPIA compliant by design",
      body: "Candidate data hosted in South Africa on Azure. Consent management, retention policies, and audit trails built in.",
    },
    {
      title: "Transparent rationale",
      body: "Every score comes with a plain-language explanation. You see exactly why each candidate made the list.",
    },
    {
      title: "BEE reporting ready",
      body: "Shortlist demographics captured and reported to support your transformation objectives.",
    },
  ];

  return (
    <section ref={ref} id="about" className="py-24 sm:py-32 bg-cream scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <h2 className="animate-on-scroll font-serif text-txt-primary text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight">
          Why TalentStream
        </h2>
        <div className="mt-12 sm:mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${i + 1} bg-surface border border-border rounded-xl p-6 sm:p-8 relative`}
            >
              {/* Top accent bar */}
              <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-accent/20 via-gold/40 to-transparent" />
              <h3 className="font-sans font-semibold text-txt-primary text-base mt-1">
                {item.title}
              </h3>
              <p className="mt-3 font-sans text-sm text-txt-secondary leading-relaxed">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ─── */
function Pricing() {
  const ref = useScrollAnimation();

  const tiers = [
    {
      name: "Standard",
      price: "R25,000–R35,000",
      desc: "Roles up to R500k CTC",
      features: [
        "Branded campaign page",
        "3–5 gating questions",
        "AI scoring",
        "WhatsApp follow-ups",
        "Shortlist of up to 10 candidates",
      ],
      popular: false,
    },
    {
      name: "Senior",
      price: "R40,000–R55,000",
      desc: "Roles R500k–R800k CTC",
      features: [
        "Everything in Standard, plus:",
        "Extended campaign duration",
        "Deeper scoring rubric",
        "Priority support",
      ],
      popular: true,
    },
    {
      name: "Executive",
      price: "R60,000–R80,000",
      desc: "Roles above R800k CTC",
      features: [
        "Everything in Senior, plus:",
        "Dedicated campaign manager",
        "Enhanced BEE reporting",
        "90-day replacement guarantee",
      ],
      popular: false,
    },
  ];

  return (
    <section ref={ref} id="pricing" className="py-24 sm:py-32 bg-surface scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <h2 className="animate-on-scroll font-serif text-txt-primary text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight">
          Simple, transparent pricing
        </h2>
        <div className="mt-12 sm:mt-16 grid sm:grid-cols-3 gap-6">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`animate-on-scroll stagger-${i + 1} rounded-xl p-6 sm:p-8 relative border ${
                tier.popular
                  ? "border-gold bg-surface ring-1 ring-gold/20"
                  : "border-border bg-surface"
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-6">
                  <span className="inline-block bg-gold text-white text-xs font-sans font-medium px-3 py-1 rounded-full">
                    Most popular
                  </span>
                </div>
              )}
              <h3 className="font-sans font-semibold text-txt-primary text-lg">
                {tier.name}
              </h3>
              <p className="mt-3 font-mono text-2xl sm:text-[1.75rem] text-accent font-medium tracking-tight">
                {tier.price}
              </p>
              <p className="mt-1 font-sans text-sm text-txt-muted">{tier.desc}</p>
              <ul className="mt-6 space-y-3">
                {tier.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm font-sans text-txt-secondary">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-gold flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="animate-on-scroll mt-8 font-sans text-sm text-txt-muted text-center">
          Ad spend is additional and passed through at cost. All prices exclude&nbsp;VAT.
        </p>
        <div className="animate-on-scroll mt-8 text-center">
          <a
            href="#get-started"
            className="inline-flex items-center justify-center h-12 px-7 bg-accent text-white text-sm sm:text-base font-sans font-medium rounded-lg hover:bg-accent-light transition-colors"
          >
            Get Started
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Social Proof / Trust ─── */
function SocialProof() {
  const ref = useScrollAnimation();

  const stats = [
    { value: "2–3 weeks", label: "Average time to shortlist" },
    { value: "40–60%", label: "Savings vs traditional agencies" },
    { value: "12", label: "Candidates scored per hour by AI" },
  ];

  return (
    <section ref={ref} className="py-24 sm:py-32 bg-cream">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <h2 className="animate-on-scroll font-serif text-txt-primary text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight text-center">
          Built for South African hiring
        </h2>
        <div className="mt-14 sm:mt-20 grid sm:grid-cols-3 gap-10 sm:gap-6">
          {stats.map((s, i) => (
            <div key={i} className={`animate-on-scroll stagger-${i + 1} text-center`}>
              <p className="font-mono text-4xl sm:text-5xl text-accent font-medium tracking-tight">
                {s.value}
              </p>
              <p className="mt-3 font-sans text-sm text-txt-secondary">
                {s.label}
              </p>
            </div>
          ))}
        </div>
        <p className="animate-on-scroll mt-16 font-sans text-sm text-txt-muted text-center max-w-md mx-auto">
          Currently onboarding founding clients — get in touch for pilot pricing
        </p>
      </div>
    </section>
  );
}

/* ─── Final CTA ─── */
function FinalCTA() {
  const ref = useScrollAnimation();

  return (
    <section ref={ref} id="get-started" className="py-24 sm:py-32 bg-accent scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8 text-center">
        <h2 className="animate-on-scroll font-serif text-white text-3xl sm:text-4xl lg:text-[2.75rem] tracking-tight">
          Ready to hire smarter?
        </h2>
        <p className="animate-on-scroll stagger-1 mt-4 font-sans text-white/70 text-lg max-w-md mx-auto">
          Tell us about the role. We will have your campaign live within 24&nbsp;hours.
        </p>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="animate-on-scroll stagger-2 mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto"
        >
          <input
            type="email"
            placeholder="Your email"
            className="h-12 w-full sm:flex-1 px-4 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 font-sans text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold transition-colors"
          />
          <button
            type="submit"
            className="h-12 px-7 w-full sm:w-auto bg-gold text-white font-sans text-sm font-medium rounded-lg hover:bg-gold-light transition-colors flex-shrink-0"
          >
            Get Started
          </button>
        </form>
        <p className="animate-on-scroll stagger-3 mt-6 font-sans text-sm text-white/50">
          Or email us directly at{" "}
          <a href="mailto:hello@talentstream.co.za" className="underline underline-offset-2 hover:text-white/70 transition-colors">
            hello@talentstream.co.za
          </a>
        </p>
      </div>
    </section>
  );
}

/* ─── Footer ─── */
function Footer() {
  return (
    <footer className="py-10 sm:py-12 bg-cream border-t border-border">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <span className="font-serif italic text-lg text-txt-primary tracking-tight">
              TalentStream
            </span>
            <p className="mt-2 font-sans text-xs text-txt-muted">
              Hosted on Azure South Africa. Your data never leaves the country.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a href="#how-it-works" className="font-sans text-sm text-txt-secondary hover:text-txt-primary transition-colors">
              How It Works
            </a>
            <a href="#pricing" className="font-sans text-sm text-txt-secondary hover:text-txt-primary transition-colors">
              Pricing
            </a>
            <a href="#" className="font-sans text-sm text-txt-secondary hover:text-txt-primary transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="font-sans text-sm text-txt-secondary hover:text-txt-primary transition-colors">
              POPIA
            </a>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-border">
          <p className="font-sans text-xs text-txt-muted">
            &copy; 2026 TalentStream. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ─── */
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <ProblemStatement />
        <HowItWorks />
        <Benefits />
        <Pricing />
        <SocialProof />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
