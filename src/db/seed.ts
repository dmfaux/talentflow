import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

// ── Deterministic random ─────────────────────────────────────────────

let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rand() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}
function weighted<T>(items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}
function normalScore(mean: number, stddev: number): number {
  const u1 = Math.max(rand(), 0.0001);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.min(10, mean + z * stddev));
}
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
function minutesAgo(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d;
}

// ── Source data ──────────────────────────────────────────────────────

const CLIENTS = [
  {
    slug: "nedbank-digital", name: "Nedbank Digital",
    contact_name: "Thandi Mkhize", contact_email: "thandi.mkhize@nedbank.co.za",
    contact_phone: "+27 11 294 4444", billing_email: "accounts.digital@nedbank.co.za",
    notes: "Expanding digital banking team. Key partner for Q1-Q2 hiring.",
    brand_primary_color: "#006341", brand_secondary_color: "#f2f7f4",
    brand_accent_color: "#b4c905", brand_text_color: "#0b1f14",
    logo_background: "light", logo_position: "top-left",
  },
  {
    slug: "discovery-health", name: "Discovery Health",
    contact_name: "Michael van der Merwe", contact_email: "michael.vdm@discovery.co.za",
    contact_phone: "+27 11 529 2888", billing_email: "hr.invoicing@discovery.co.za",
    notes: "Focus on data science and actuarial roles.",
    brand_primary_color: "#00457c", brand_secondary_color: "#eef3f8",
    brand_accent_color: "#ff6b00", brand_text_color: "#0b1424",
    logo_background: "light", logo_position: "top-left",
  },
  {
    slug: "takealot-commerce", name: "Takealot Commerce",
    contact_name: "Sizwe Dlamini", contact_email: "sizwe.d@takealot.com",
    contact_phone: "+27 21 809 5900", billing_email: "finance@takealot.com",
    notes: "Rapid scaling across engineering and product teams.",
    brand_primary_color: "#00a862", brand_secondary_color: "#eefbf4",
    brand_accent_color: "#ffb01f", brand_text_color: "#0b1f14",
    logo_background: "light", logo_position: "top-left",
  },
  {
    slug: "anglo-american", name: "Anglo American",
    contact_name: "Priya Naidoo", contact_email: "priya.naidoo@angloamerican.com",
    contact_phone: "+27 11 638 9111", billing_email: "talent.ops@angloamerican.com",
    notes: "Technology modernisation programme. Platform and cloud roles.",
    brand_primary_color: "#003057", brand_secondary_color: "#f2f4f7",
    brand_accent_color: "#e4b80e", brand_text_color: "#0b1424",
    logo_background: "light", logo_position: "top-centre",
  },
  {
    slug: "woolworths-holdings", name: "Woolworths Holdings",
    contact_name: "Lerato Mokoena", contact_email: "lerato.mokoena@woolworths.co.za",
    contact_phone: "+27 21 407 9111", billing_email: "recruitment.finance@woolworths.co.za",
    notes: "Retail technology transformation.",
    brand_primary_color: "#00573c", brand_secondary_color: "#f3f5f2",
    brand_accent_color: "#9a8250", brand_text_color: "#0b1414",
    logo_background: "light", logo_position: "top-left",
  },
  {
    slug: "mtn-group", name: "MTN Group",
    contact_name: "Johan Pretorius", contact_email: "johan.pretorius@mtn.com",
    contact_phone: "+27 11 912 3000", billing_email: "vendor.payments@mtn.com",
    notes: "Fintech and 5G platform initiatives.",
    brand_primary_color: "#ffcc00", brand_secondary_color: "#1a1a1a",
    brand_accent_color: "#ff6b00", brand_text_color: "#1a1a1a",
    logo_background: "dark", logo_position: "top-left",
  },
  {
    slug: "standard-bank-tech", name: "Standard Bank Tech",
    contact_name: "Ayesha Patel", contact_email: "ayesha.patel@standardbank.co.za",
    contact_phone: "+27 11 721 5000", billing_email: "ap.tech@standardbank.co.za",
    notes: "Core banking platform rewrite. Multiple senior roles.",
    brand_primary_color: "#0033a0", brand_secondary_color: "#eef1f8",
    brand_accent_color: "#e30613", brand_text_color: "#0b1424",
    logo_background: "light", logo_position: "top-left",
  },
  {
    slug: "adcorp-group", name: "Adcorp Group",
    contact_name: "Ayesha Patel", contact_email: "ayesha.patel@adcorpgroup.com",
    contact_phone: "+27 11 721 5000", billing_email: "ap.tech@adcorp-group.com",
    notes: "Core banking platform rewrite. Multiple senior roles.",
    brand_primary_color: "#6b2c91", brand_secondary_color: "#f5f1f8",
    brand_accent_color: "#f39c12", brand_text_color: "#1a0b24",
    logo_background: "light", logo_position: "top-left",
  },
] as const;

const ROLES = [
  {
    title: "Senior Backend Engineer", department: "Engineering", employment_type: "Permanent",
    salary_min: 850000, salary_max: 1200000,
    description: "Design, build, and maintain scalable backend services powering our core platform. You will own end-to-end delivery of APIs, data pipelines, and event-driven microservices, collaborating closely with product and infrastructure teams.",
  },
  {
    title: "Staff Data Scientist", department: "Data", employment_type: "Permanent",
    salary_min: 950000, salary_max: 1400000,
    description: "Lead the design and delivery of ML models and data products that drive strategic decision-making. Mentor a team of junior data scientists while partnering with engineering to deploy models at scale.",
  },
  {
    title: "Product Manager", department: "Product", employment_type: "Permanent",
    salary_min: 800000, salary_max: 1100000,
    description: "Own the product roadmap for a key business vertical, translating customer insights and market research into prioritised features. Work cross-functionally with engineering, design, and commercial teams to ship impactful products.",
  },
  {
    title: "DevOps Engineer", department: "Platform", employment_type: "Permanent",
    salary_min: 700000, salary_max: 1000000,
    description: "Build and maintain our CI/CD pipelines, infrastructure-as-code, and monitoring stack. Drive reliability and developer productivity across multiple product squads using Kubernetes, Terraform, and observability tooling.",
  },
  {
    title: "Senior Frontend Developer", department: "Engineering", employment_type: "Permanent",
    salary_min: 750000, salary_max: 1100000,
    description: "Craft performant, accessible user experiences using React and TypeScript. Collaborate with designers and backend engineers to deliver polished features with a focus on performance, responsiveness, and code quality.",
  },
  {
    title: "QA Automation Engineer", department: "Quality", employment_type: "Permanent",
    salary_min: 550000, salary_max: 800000,
    description: "Design and implement automated testing strategies across web, mobile, and API layers. Champion quality engineering practices and integrate testing into the CI/CD pipeline to catch regressions early.",
  },
  {
    title: "Mobile Developer (iOS)", department: "Engineering", employment_type: "Permanent",
    salary_min: 750000, salary_max: 1050000,
    description: "Build and ship native iOS features using Swift and SwiftUI. Collaborate with product and design to create intuitive mobile experiences while maintaining performance, accessibility, and a clean codebase.",
  },
  {
    title: "Platform Architect", department: "Engineering", employment_type: "Permanent",
    salary_min: 1200000, salary_max: 1800000,
    description: "Define the technical vision and architecture for our core platform, making key decisions around scalability, security, and developer experience. Provide technical leadership across multiple squads and drive adoption of best practices.",
  },
  {
    title: "Machine Learning Engineer", department: "Data", employment_type: "Permanent",
    salary_min: 900000, salary_max: 1350000,
    description: "Bridge the gap between data science research and production systems. Design ML pipelines, feature stores, and inference services that run reliably at scale, collaborating closely with data scientists and platform engineers.",
  },
  {
    title: "Security Engineer", department: "Security", employment_type: "Permanent",
    salary_min: 800000, salary_max: 1200000,
    description: "Protect our systems and data by implementing security controls, conducting threat modelling, and running penetration tests. Embed security into the development lifecycle and respond to incidents across the organisation.",
  },
] as const;

const LOCATIONS = ["Johannesburg", "Cape Town", "Sandton", "Durban", "Stellenbosch", "Pretoria"] as const;

const FIRST_NAMES = [
  "Thabo", "Lerato", "Sipho", "Nomsa", "Kagiso", "Zanele", "Bongani", "Palesa",
  "Michael", "Sarah", "James", "Emma", "David", "Lisa", "Chris", "Rachel",
  "Pieter", "Annika", "Dewald", "Marike", "Johan", "Karin", "Ruan", "Elsa",
  "Priya", "Arjun", "Anaya", "Rohan", "Zara", "Kiran", "Naledi", "Tshepo",
  "Lindiwe", "Mandla", "Refilwe", "Nhlanhla", "Gugu", "Themba", "Busisiwe", "Musa",
  "Rebecca", "Daniel", "Olivia", "Ethan", "Sophia", "Liam", "Amelia", "Noah",
];

const LAST_NAMES = [
  "Mokoena", "Dlamini", "Ndlovu", "Khumalo", "Naidoo", "Pillay", "Van der Merwe",
  "Botha", "Pretorius", "Du Plessis", "Nkosi", "Mabaso", "Zulu", "Mthembu",
  "Smith", "Jones", "Patel", "Singh", "Chetty", "Govender", "Moodley", "Reddy",
  "Oosthuizen", "Kruger", "Venter", "Coetzee", "Le Roux", "Strydom", "Visser",
  "Cele", "Mabena", "Sithole", "Mashaba", "Tshabalala", "Ngcobo", "Xaba",
];

const SOURCES = ["linkedin", "indeed", "careers-page", "referral", "jobmail", "glassdoor"];

const COMPANIES = [
  "Vodacom", "FNB", "Investec", "MultiChoice", "Accenture SA", "Deloitte", "BCX",
  "Capitec", "Outsurance", "BBD", "Entelect", "Synthesis", "Amazon AWS (Cape Town)",
  "Microsoft SA", "Old Mutual", "Sanlam", "Momentum", "PwC", "KPMG",
  "DVT", "Retro Rabbit", "ThoughtWorks", "Shoprite Group", "Dimension Data",
];

const UNIVERSITIES = [
  "University of Cape Town", "University of the Witwatersrand", "Stellenbosch University",
  "University of Pretoria", "University of Johannesburg", "Rhodes University",
  "University of KwaZulu-Natal", "North-West University", "UNISA",
];

const TECH_SKILLS: Record<string, string[]> = {
  Engineering: ["TypeScript", "Node.js", "React", "PostgreSQL", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "GraphQL", "REST APIs", "Go", "Java", "Python", "Git"],
  Data: ["Python", "SQL", "TensorFlow", "PyTorch", "Spark", "Airflow", "dbt", "Snowflake", "R", "scikit-learn", "Pandas", "Jupyter", "MLflow", "AWS SageMaker"],
  Platform: ["Terraform", "Kubernetes", "Docker", "AWS", "Azure", "GCP", "CI/CD", "Jenkins", "GitHub Actions", "Prometheus", "Grafana", "Linux", "Ansible", "Helm"],
  Product: ["Jira", "Figma", "SQL", "A/B testing", "User research", "Roadmapping", "Agile/Scrum", "Data analysis", "Stakeholder management"],
  Quality: ["Selenium", "Cypress", "Playwright", "Jest", "JUnit", "Postman", "k6", "CI/CD", "Python", "Java", "API testing", "Performance testing"],
  Security: ["OWASP", "Burp Suite", "Nessus", "Terraform", "AWS Security", "SIEM", "SOC", "Penetration testing", "Python", "Kubernetes security", "IAM", "Zero Trust"],
};

const FLAG_TEMPLATES: Record<string, string[]> = {
  tenure: [
    "Two recent roles with tenure under 12 months — clarify reasons for departures",
    "Three job changes in the past 4 years — pattern worth exploring",
    "Left previous role after only 8 months — unclear if performance-related",
  ],
  gap: [
    "CV gap between 2021 and 2022 not explained",
    "18-month gap after leaving previous employer — no context provided",
    "Gap year noted between 2020-2021 — may be COVID-related but unconfirmed",
  ],
  overqualified: [
    "15+ years experience applying for a mid-level role — possible misalignment on seniority",
    "Previous titles suggest significantly more senior scope — check expectations",
  ],
  underqualified: [
    "Limited evidence of the specific technology stack mentioned in must-haves",
    "Only 2 years experience for a senior role requiring 5+ — skills may compensate",
    "Self-assessed skill levels differ significantly from work history",
  ],
  general: [
    "Job titles inconsistent with stated experience level",
    "References not provided — may indicate early-stage application",
    "CV formatting issues — content appears auto-generated or templated",
  ],
};

// ── CV text generator ──────────────────────────────────────────────

function generateCvText(
  name: string,
  department: string,
  yearsExp: number,
  score: number
): string {
  const skills = TECH_SKILLS[department] ?? TECH_SKILLS.Engineering;
  const numSkills = score >= 8 ? randInt(8, 12) : score >= 6 ? randInt(5, 8) : randInt(3, 5);
  const candidateSkills = pickN(skills, numSkills);
  const uni = pick(UNIVERSITIES);
  const degree = department === "Data"
    ? pick(["BSc Computer Science", "BSc Mathematical Statistics", "MSc Data Science", "BSc Applied Mathematics"])
    : department === "Product"
      ? pick(["BCom Business Science", "BA Information Systems", "MBA", "BSc Computer Science"])
      : pick(["BSc Computer Science", "BSc Information Technology", "BEng Computer Engineering", "BSc Computer Science (Honours)"]);
  const gradYear = new Date().getFullYear() - yearsExp - randInt(0, 2);

  const numRoles = Math.min(yearsExp <= 3 ? randInt(1, 2) : yearsExp <= 7 ? randInt(2, 4) : randInt(3, 5), 5);
  const roles: string[] = [];
  let remainingYears = yearsExp;

  for (let i = 0; i < numRoles && remainingYears > 0; i++) {
    const company = pick(COMPANIES);
    const tenure = i === 0
      ? Math.min(remainingYears, randInt(1, 4))
      : Math.min(remainingYears, randInt(1, 3));
    remainingYears -= tenure;
    const endYear = new Date().getFullYear() - (i === 0 ? 0 : remainingYears + tenure);
    const startYear = endYear - tenure;

    const titles = department === "Engineering"
      ? ["Junior Developer", "Software Developer", "Senior Developer", "Lead Engineer", "Principal Engineer", "Staff Engineer"]
      : department === "Data"
        ? ["Data Analyst", "Data Scientist", "Senior Data Scientist", "Lead Data Scientist", "Principal Data Scientist"]
        : department === "Platform"
          ? ["Junior DevOps Engineer", "DevOps Engineer", "Senior DevOps Engineer", "Platform Lead", "Staff Platform Engineer"]
          : department === "Product"
            ? ["Associate PM", "Product Manager", "Senior Product Manager", "Head of Product"]
            : department === "Quality"
              ? ["Test Analyst", "QA Engineer", "Senior QA Engineer", "QA Lead", "QA Manager"]
              : ["Analyst", "Engineer", "Senior Engineer", "Lead", "Principal"];

    const titleIdx = Math.min(Math.floor((yearsExp - remainingYears) / 2.5), titles.length - 1);
    const title = titles[titleIdx];

    const achievements = score >= 8
      ? [
          `Led a team of ${randInt(3, 8)} engineers to deliver a ${pick(["payment gateway", "real-time analytics dashboard", "customer onboarding platform", "API gateway", "data pipeline", "mobile app redesign"])}`,
          `Reduced ${pick(["deployment time by 60%", "API latency by 40%", "infrastructure costs by R2M annually", "bug rate by 35%", "onboarding time from 2 weeks to 2 days"])}`,
          `Mentored ${randInt(2, 5)} junior team members and established ${pick(["code review practices", "testing standards", "architecture decision records", "incident response playbooks"])}`,
        ]
      : score >= 6
        ? [
            `Contributed to the development of ${pick(["internal tools", "customer-facing features", "API integrations", "reporting dashboards", "mobile features"])}`,
            `Participated in ${pick(["agile ceremonies", "code reviews", "on-call rotation", "sprint planning", "technical design sessions"])} and ${pick(["improved test coverage", "maintained documentation", "supported production releases"])}`,
          ]
        : [
            `Worked on ${pick(["bug fixes", "feature requests", "maintenance tasks", "documentation", "support tickets"])}`,
            `Assisted with ${pick(["deployments", "testing", "data entry", "client communications"])}`,
          ];

    roles.push(`${title} at ${company} (${startYear}–${i === 0 ? "Present" : endYear})\n${achievements.map((a) => `- ${a}`).join("\n")}`);
  }

  return `${name}

PROFESSIONAL SUMMARY
${score >= 8
    ? `Accomplished ${department.toLowerCase()} professional with ${yearsExp}+ years of experience delivering high-impact solutions. Proven track record of technical leadership, mentorship, and driving measurable business outcomes across fast-paced environments.`
    : score >= 6
      ? `Experienced ${department.toLowerCase()} professional with ${yearsExp} years in the industry. Solid foundation in core technologies with a focus on collaborative delivery and continuous learning.`
      : `${department} professional with ${yearsExp} years of experience. Seeking new opportunities to grow and develop skills in a challenging environment.`}

SKILLS
${candidateSkills.join(", ")}

EXPERIENCE
${roles.join("\n\n")}

EDUCATION
${degree}, ${uni} (${gradYear})${score >= 8 && rand() < 0.5 ? `\nCum Laude` : ""}${rand() < 0.3 ? `\n${pick(["AWS Certified Solutions Architect", "Google Cloud Professional Data Engineer", "Certified Kubernetes Administrator", "PMP", "Certified Scrum Master", "CISSP"])}` : ""}`;
}

// ── Chat conversation templates ─────────────────────────────────────

interface ChatScript {
  topicsCovered: "all" | "partial" | "none";
  withdrawn?: boolean;
  messages: { role: "assistant" | "user"; content: string }[];
}

function generateChatScript(
  candidateName: string,
  roleTitle: string,
  companyName: string,
  flags: string[],
  outcome: "all_covered" | "partial" | "withdrawn"
): ChatScript {
  const firstName = candidateName.split(" ")[0];
  const messages: ChatScript["messages"] = [];

  // Greeting
  messages.push({
    role: "assistant",
    content: `Hi ${firstName}! Thanks for applying for the ${roleTitle} position at ${companyName}. I have a few follow-up questions about your application — this should only take a few minutes. Let me know when you're ready to start!`,
  });
  messages.push({
    role: "user",
    content: pick(["Sure, I'm ready!", "Hi! Yes, let's go.", "Ready when you are.", `Thanks for reaching out. Happy to chat.`]),
  });

  const flagCount = flags.length;
  const topicsToCover = outcome === "all_covered" ? flagCount : outcome === "withdrawn" ? Math.min(1, flagCount) : Math.max(1, Math.floor(flagCount / 2));

  for (let i = 0; i < topicsToCover; i++) {
    const flag = flags[i];
    const lower = flag.toLowerCase();

    // Assistant asks about the flag
    if (lower.includes("tenure") || lower.includes("stint")) {
      messages.push({
        role: "assistant",
        content: `I noticed you've had a couple of career transitions recently. Could you walk me through what motivated those moves? Specific details about the circumstances would really help the team understand your career path.`,
      });
      messages.push({
        role: "user",
        content: `Yes, absolutely. I left ${pick(COMPANIES)} after ${randInt(8, 14)} months because the team was restructured and my role changed significantly — I was hired to lead backend architecture but ended up mostly doing support tickets. Before that, I moved from ${pick(COMPANIES)} because I was offered a senior role that was a step up in responsibility. Both were deliberate moves to find a better fit.`,
      });
    } else if (lower.includes("gap") || lower.includes("break")) {
      messages.push({
        role: "assistant",
        content: `I see there was a career break on your CV. I'd love to hear what you were up to during that time — any context you can share would be helpful for the team.`,
      });
      messages.push({
        role: "user",
        content: pick([
          `I took time off to care for a family member who was ill. During that period I also completed an online ${pick(["AWS certification", "Google Cloud course", "machine learning specialisation", "product management programme"])} to keep my skills sharp. I was eager to get back to work and feel ready to contribute fully.`,
          `I relocated from ${pick(["Durban", "Port Elizabeth", "Bloemfontein"])} to ${pick(["Johannesburg", "Cape Town"])} for personal reasons. The move took longer than expected, but I used the time to freelance on a few projects and complete a ${pick(["Kubernetes", "data engineering", "React Native"])} certification.`,
          `That was a sabbatical I'd planned for a while. I spent 6 months travelling and then 6 months doing volunteer tech work for an NGO in ${pick(["Khayelitsha", "Soweto", "Limpopo"])}. It was refreshing and gave me a new perspective on impact-driven development.`,
        ]),
      });
    } else if (lower.includes("overqualified")) {
      messages.push({
        role: "assistant",
        content: `Your background is quite impressive — can you tell me what specifically excites you about this role and how you see it fitting into your career goals?`,
      });
      messages.push({
        role: "user",
        content: `Great question. I've been in leadership roles for a while, but I genuinely miss the hands-on technical work. This role at ${companyName} caught my eye because it's a chance to work on ${pick(["greenfield architecture", "a modern tech stack", "a product I actually use", "challenging scaling problems"])} without the overhead of managing a large org. I'm looking for depth over breadth at this stage.`,
      });
    } else if (lower.includes("underqualified") || lower.includes("missing")) {
      messages.push({
        role: "assistant",
        content: `Some of the requirements for this role are quite specific. Could you share how you've developed skills in related areas and your approach to picking up new technologies?`,
      });
      messages.push({
        role: "user",
        content: `I don't have direct experience with ${pick(["Kubernetes", "the specific cloud platform", "that particular framework", "Terraform at scale"])}, but at ${pick(COMPANIES)} I worked on something very similar — ${pick(["container orchestration with Docker Swarm", "multi-cloud deployments", "a comparable framework", "infrastructure automation with Ansible"])}. I'm a fast learner and I've consistently ramped up on new stacks within a few weeks. My manager at ${pick(COMPANIES)} can confirm that.`,
      });
    } else if (lower.includes("title") || lower.includes("inconsistent")) {
      messages.push({
        role: "assistant",
        content: `I noticed some variation in job titles across your CV. Could you help me understand the scope and responsibilities in your most recent roles?`,
      });
      messages.push({
        role: "user",
        content: `Sure — the titles can be misleading. At ${pick(COMPANIES)}, "Developer" was the standard title for everyone, but I was effectively leading a squad of ${randInt(4, 7)} people and owning the technical roadmap for our payments module. At ${pick(COMPANIES)}, my "Senior Engineer" title actually involved architecture decisions for the whole platform. I'm happy to provide references who can speak to the scope.`,
      });
    } else {
      // Generic flag handling
      messages.push({
        role: "assistant",
        content: `I'd like to understand a bit more about your background. ${flag} — could you provide some specific details or context?`,
      });
      messages.push({
        role: "user",
        content: `Of course. At ${pick(COMPANIES)}, I worked on that for about ${randInt(1, 3)} years. Specifically, I ${pick(["led the migration to a new system", "built the initial prototype", "managed the team responsible for it", "implemented the core logic"])}. Happy to elaborate if you need more details.`,
      });
    }

    // Assistant acknowledgement and transition (except for last covered topic)
    if (i < topicsToCover - 1) {
      messages.push({
        role: "assistant",
        content: pick([
          `That's really helpful context, thank you. Let me move on to another area I'd like to explore.`,
          `Thanks for sharing that — the detail really helps. I have one more thing I'd like to ask about.`,
          `Appreciated, ${firstName}. That gives the team a much clearer picture. Let me ask about something else.`,
        ]),
      });
    }
  }

  if (outcome === "withdrawn") {
    // Candidate wants to stop and confirms withdrawal
    messages.push({
      role: "user",
      content: pick([
        "Actually, I've been thinking about it and I'd like to withdraw my application. I've accepted another offer.",
        "I appreciate the chat but I'd like to withdraw from the process. The role isn't quite what I expected.",
        "Thanks for your time, but I've decided to go in a different direction. Please withdraw my application.",
      ]),
    });
    messages.push({
      role: "assistant",
      content: `I completely understand, ${firstName}. Thank you for letting us know, and congratulations if you've found another opportunity! We appreciate the time you invested in the process. Wishing you all the best — don't hesitate to apply again in the future if anything catches your eye.`,
    });
    return { topicsCovered: "partial", withdrawn: true, messages };
  }

  if (outcome === "all_covered") {
    messages.push({
      role: "assistant",
      content: `Thank you so much for taking the time to chat, ${firstName}. You've given us a really thorough picture of your background and I'll make sure all of this gets to the recruitment team. They'll be in touch with next steps — we appreciate your patience!`,
    });
    return { topicsCovered: "all", messages };
  }

  // Partial — conversation still in progress (dormant/active)
  return { topicsCovered: "partial", messages };
}

// ── Gating question templates ────────────────────────────────────────

function buildGating(department: string) {
  if (department === "Engineering" || department === "Platform") {
    return [
      { id: "exp_years", label: "How many years of relevant engineering experience do you have?", type: "select",
        options: [{ value: "0-2" }, { value: "3-5" }, { value: "6-8" }, { value: "9+" }],
        pass_criteria: ["3-5", "6-8", "9+"] },
      { id: "work_auth", label: "Do you have the right to work in South Africa?", type: "select",
        options: [{ value: "Yes, SA citizen or permanent resident" }, { value: "Yes, valid work permit" }, { value: "No" }],
        pass_criteria: ["Yes, SA citizen or permanent resident", "Yes, valid work permit"] },
      { id: "remote_pref", label: "Are you open to hybrid work (3 days in office)?", type: "select",
        options: [{ value: "Yes" }, { value: "No, remote only" }, { value: "No, office only" }],
        pass_criteria: ["Yes", "No, office only"] },
      { id: "notice", label: "What is your notice period?", type: "select",
        options: [{ value: "Immediate" }, { value: "2 weeks" }, { value: "1 month" }, { value: "2 months" }, { value: "3+ months" }],
        pass_criteria: ["Immediate", "2 weeks", "1 month", "2 months"] },
    ];
  }
  if (department === "Data" || department === "Quality") {
    return [
      { id: "exp_years", label: "Years of relevant experience?", type: "select",
        options: [{ value: "0-2" }, { value: "3-5" }, { value: "6+" }],
        pass_criteria: ["3-5", "6+"] },
      { id: "work_auth", label: "Are you legally allowed to work in South Africa?", type: "select",
        options: [{ value: "Yes" }, { value: "No" }],
        pass_criteria: ["Yes"] },
      { id: "degree", label: "Do you have a relevant degree (CS, Stats, Engineering)?", type: "select",
        options: [{ value: "Yes" }, { value: "No, but equivalent experience" }, { value: "No" }],
        pass_criteria: ["Yes", "No, but equivalent experience"] },
    ];
  }
  return [
    { id: "exp_years", label: "How many years of experience do you have in a similar role?", type: "select",
      options: [{ value: "0-2" }, { value: "3-5" }, { value: "6+" }],
      pass_criteria: ["3-5", "6+"] },
    { id: "work_auth", label: "Are you eligible to work in South Africa?", type: "select",
      options: [{ value: "Yes" }, { value: "No" }],
      pass_criteria: ["Yes"] },
    { id: "notice", label: "What is your notice period?", type: "select",
      options: [{ value: "Immediate" }, { value: "1 month" }, { value: "2 months" }, { value: "3+ months" }],
      pass_criteria: ["Immediate", "1 month", "2 months"] },
  ];
}

function buildRubric(title: string) {
  const isSenior = title.includes("Senior") || title.includes("Staff") || title.includes("Architect");
  return {
    must_haves: isSenior
      ? ["5+ years relevant experience", "Strong track record of delivery", "Experience leading technical decisions"]
      : ["2+ years relevant experience", "Solid fundamentals in core technologies"],
    nice_to_haves: ["Cloud platform experience (AWS/Azure/GCP)", "Open source contributions", "Mentorship experience"],
    dealbreakers: ["No relevant professional experience", "Cannot provide references", "Major gaps in core competencies"],
    dimension_weights: { skills: 35, experience: 30, progression: 20, tenure: 15 },
  };
}

// ── AI rationale templates ──────────────────────────────────────────

const RATIONALES_STRONG = [
  "Strong technical background with clear progression through senior roles. Skills align closely with requirements and tenure patterns suggest stability and growth.",
  "Excellent fit — demonstrated experience across the required stack with measurable impact in prior roles. Career trajectory is upward and consistent.",
  "Highly experienced candidate with directly relevant skills. Leadership experience evident and tenure at each role averages 3+ years.",
  "Solid match on all dimensions. Skills match is strong, progression shows increasing scope, and the candidate has stayed at previous employers long enough to drive outcomes.",
];
const RATIONALES_GOOD = [
  "Good technical fit with most required skills. Experience is adequate though slightly below the senior level; progression has been steady.",
  "Decent candidate with relevant background. Some skills gaps in secondary areas but core competencies are strong.",
  "Experience is on the lighter side for this role but compensated by strong recent performance and upward trajectory.",
  "Core skills align well with the rubric. Career progression is positive though some shorter tenures may warrant clarification.",
];
const RATIONALES_WEAK = [
  "Partial fit — core skills present but depth is limited. Experience falls short of the senior criteria.",
  "Some relevant experience but significant gaps in must-have skills. Progression has been flat.",
  "Background is adjacent rather than directly relevant. Would require substantial onboarding.",
  "Skills match is weak on several must-haves. Would not recommend without additional screening.",
];

// ── Main seed function ───────────────────────────────────────────────

async function main() {
  console.log("Seeding database...\n");

  // ── Clear existing data in dependency order ──
  console.log("Clearing existing data...");
  await db.delete(schema.chatMessages);
  await db.delete(schema.conversations);
  await db.delete(schema.chatTokens);
  await db.delete(schema.events);
  await db.delete(schema.jobs);
  await db.delete(schema.scoringLogs);
  await db.delete(schema.messages);
  await db.delete(schema.candidates);
  await db.delete(schema.campaigns);
  await db.delete(schema.passwordResetTokens);
  await db.delete(schema.users);
  await db.delete(schema.clients);
  console.log("Done.\n");

  // ── Insert clients ──
  console.log(`Inserting ${CLIENTS.length} clients...`);
  const insertedClients = await db.insert(schema.clients).values(
    CLIENTS.map((c) => ({
      slug: c.slug,
      name: c.name,
      contact_name: c.contact_name,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
      billing_email: c.billing_email,
      notes: c.notes,
      is_active: true,
      brand_primary_color: c.brand_primary_color,
      brand_secondary_color: c.brand_secondary_color,
      brand_accent_color: c.brand_accent_color,
      brand_text_color: c.brand_text_color,
      logo_background: c.logo_background,
      logo_position: c.logo_position,
    }))
  ).returning({ id: schema.clients.id, slug: schema.clients.slug, name: schema.clients.name });

  // ── Generate campaigns — 2-4 per client ──
  console.log("Generating campaigns...");
  const campaignsToInsert: typeof schema.campaigns.$inferInsert[] = [];

  for (const c of insertedClients) {
    const count = randInt(2, 4);
    const usedRoles = new Set<string>();
    for (let i = 0; i < count; i++) {
      const role = pick(ROLES.filter((r) => !usedRoles.has(r.title)));
      usedRoles.add(role.title);

      const baseSlug = role.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const status = weighted([
        { value: "active", weight: 5 },
        { value: "draft", weight: 2 },
        { value: "paused", weight: 1 },
        { value: "closed", weight: 2 },
      ]);

      const campaignStart = status === "active" || status === "paused" || status === "closed"
        ? daysAgo(randInt(5, 45)) : null;
      const campaignEnd = status === "closed" ? daysAgo(randInt(1, 10)) : null;

      campaignsToInsert.push({
        client_id: c.id,
        slug: baseSlug,
        role_title: role.title,
        role_description: role.description,
        department: role.department,
        location: pick(LOCATIONS),
        employment_type: role.employment_type,
        status,
        gating_config: buildGating(role.department),
        scoring_rubric: buildRubric(role.title),
        campaign_start: campaignStart,
        campaign_end: campaignEnd,
        salary_range_min: role.salary_min,
        salary_range_max: role.salary_max,
        chat_lifecycle: pick(["topics_complete", "topics_complete", "dormant"]),
      });
    }
  }

  const insertedCampaigns = await db.insert(schema.campaigns).values(campaignsToInsert).returning({
    id: schema.campaigns.id,
    slug: schema.campaigns.slug,
    client_id: schema.campaigns.client_id,
    status: schema.campaigns.status,
    role_title: schema.campaigns.role_title,
    department: schema.campaigns.department,
    gating_config: schema.campaigns.gating_config,
    chat_lifecycle: schema.campaigns.chat_lifecycle,
  });

  // Build a lookup from campaign_id to client for chat scripts
  const clientByCampaign = new Map<string, { slug: string; name: string }>();
  for (const camp of insertedCampaigns) {
    const cl = insertedClients.find((c) => c.id === camp.client_id);
    if (cl) clientByCampaign.set(camp.id, { slug: cl.slug, name: cl.name });
  }

  console.log(`Inserted ${insertedCampaigns.length} campaigns.\n`);

  // ── Generate candidates ──
  console.log("Generating candidates...");
  const candidatesToInsert: (typeof schema.candidates.$inferInsert & { _department: string })[] = [];

  for (const campaign of insertedCampaigns) {
    if (campaign.status === "draft") continue;

    const candidateCount = campaign.status === "closed"
      ? randInt(30, 60)
      : campaign.status === "active"
        ? randInt(15, 45)
        : randInt(8, 20);

    const gatingConfig = campaign.gating_config as {
      id: string; label: string; options: { value: string }[]; pass_criteria: string[];
    }[];

    for (let i = 0; i < candidateCount; i++) {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const emailDomain = pick(["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "webmail.co.za"]);
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, "")}${randInt(1, 999)}@${emailDomain}`;
      const name = `${firstName} ${lastName}`;
      const phone = `+27 ${randInt(60, 84)} ${randInt(100, 999)} ${randInt(1000, 9999)}`;

      // Build gating answers — 80% pass, 20% fail
      const willPass = rand() < 0.8;
      const answers: Record<string, string> = {};
      for (const q of gatingConfig) {
        if (willPass) {
          answers[q.id] = pick(q.pass_criteria);
        } else {
          const failOptions = q.options.map((o) => o.value).filter((v) => !q.pass_criteria.includes(v));
          answers[q.id] = failOptions.length > 0 && rand() < 0.4 ? pick(failOptions) : pick(q.pass_criteria);
        }
      }
      const gatingPassed = gatingConfig.every((q) => q.pass_criteria.includes(answers[q.id]));

      // Determine candidate status and scoring
      let status: string;
      let aiScore: number | null = null;
      let aiConfidence: string | null = null;
      let aiRationale: string | null = null;
      let aiDimensions: Record<string, number> | null = null;
      let aiFlags: string[] | null = null;
      let rejectionReason: string | null = null;

      if (!gatingPassed) {
        status = "gating_failed";
      } else {
        const scoreBucket = weighted([
          { value: "scored", weight: 40 },
          { value: "follow_up", weight: 20 },
          { value: "shortlisted", weight: 15 },
          { value: "rejected", weight: 10 },
          { value: "withdrawn", weight: 5 },
          { value: "gating_passed", weight: 10 },
        ]);
        status = scoreBucket;

        if (status !== "gating_passed") {
          const mean = status === "shortlisted" ? 8.7
            : status === "rejected" ? 4.5
            : status === "withdrawn" ? 6.5
            : status === "follow_up" ? 6.8
            : 6.5;
          aiScore = Math.round(normalScore(mean, 1.0) * 10) / 10;
          aiConfidence = aiScore >= 8.0 ? pick(["high", "high", "medium"]) : aiScore >= 6.0 ? pick(["high", "medium", "medium"]) : pick(["medium", "low", "low"]);
          aiRationale = aiScore >= 8.0 ? pick(RATIONALES_STRONG) : aiScore >= 6.5 ? pick(RATIONALES_GOOD) : pick(RATIONALES_WEAK);
          aiDimensions = {
            skills_match: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            experience_depth: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            career_progression: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            tenure_patterns: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
          };

          // Generate flags based on status
          if (status === "follow_up") {
            const flagCategory = pick(Object.keys(FLAG_TEMPLATES) as (keyof typeof FLAG_TEMPLATES)[]);
            aiFlags = [pick(FLAG_TEMPLATES[flagCategory])];
            if (rand() < 0.4) {
              const otherCategory = pick(Object.keys(FLAG_TEMPLATES).filter((c) => c !== flagCategory) as (keyof typeof FLAG_TEMPLATES)[]);
              aiFlags.push(pick(FLAG_TEMPLATES[otherCategory]));
            }
          } else {
            aiFlags = rand() < 0.2 ? [pick(FLAG_TEMPLATES.general)] : [];
          }

          if (status === "rejected") {
            rejectionReason = pick([
              "Insufficient experience for the seniority level required",
              "Skills mismatch — candidate's background is not aligned with core requirements",
              "Better-qualified candidates available for this position",
              "Candidate salary expectations significantly above budget",
              "Unable to meet location/hybrid working requirements",
            ]);
          }
        }
      }

      const yearsExp = status === "gating_failed" ? 1 : aiScore
        ? (aiScore >= 8 ? randInt(7, 15) : aiScore >= 6 ? randInt(4, 8) : randInt(1, 4))
        : randInt(3, 6);

      const department = campaign.department ?? "Engineering";
      const appliedDaysAgo = randInt(1, 30);
      const now = daysAgo(appliedDaysAgo);
      const purgeAt = new Date(now);
      purgeAt.setMonth(purgeAt.getMonth() + 12);

      const hasCv = status !== "gating_failed" && rand() < 0.85;

      candidatesToInsert.push({
        _department: department,
        campaign_id: campaign.id,
        name,
        email,
        phone,
        whatsapp_opted_in: rand() < 0.6,
        gating_answers: answers,
        gating_passed: gatingPassed,
        cv_url: hasCv ? `https://example.blob.core.windows.net/cvs/${campaign.slug}/${email.replace("@", "_at_")}.pdf` : null,
        cv_text: hasCv ? generateCvText(name, department, yearsExp, aiScore ?? 5) : null,
        ai_score: aiScore,
        ai_dimensions: aiDimensions,
        ai_rationale: aiRationale,
        ai_confidence: aiConfidence,
        ai_flags: aiFlags,
        status,
        rejection_reason: rejectionReason,
        shortlist_notes: status === "shortlisted" ? pick([
          "Strong candidate — schedule technical interview",
          "Excellent culture fit and technical depth. Fast-track.",
          "Recommended by hiring manager after CV review",
          "Top scorer with directly relevant experience",
        ]) : null,
        source: pick(SOURCES),
        popia_consent_at: now,
        data_purge_at: purgeAt,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Insert candidates in batches
  const BATCH_SIZE = 500;
  const insertedCandidates: {
    id: string; campaign_id: string; status: string; email: string;
    name: string; ai_score: number | null; ai_rationale: string | null;
    ai_dimensions: unknown; ai_confidence: string | null; ai_flags: unknown;
    _department: string;
  }[] = [];

  for (let i = 0; i < candidatesToInsert.length; i += BATCH_SIZE) {
    const batch = candidatesToInsert.slice(i, i + BATCH_SIZE);
    // Strip the helper field before inserting
    const cleanBatch = batch.map(({ _department, ...rest }) => rest);
    const result = await db.insert(schema.candidates).values(cleanBatch).returning({
      id: schema.candidates.id,
      campaign_id: schema.candidates.campaign_id,
      status: schema.candidates.status,
      email: schema.candidates.email,
      name: schema.candidates.name,
      ai_score: schema.candidates.ai_score,
      ai_rationale: schema.candidates.ai_rationale,
      ai_dimensions: schema.candidates.ai_dimensions,
      ai_confidence: schema.candidates.ai_confidence,
      ai_flags: schema.candidates.ai_flags,
    });
    // Re-attach the department for downstream use
    for (let j = 0; j < result.length; j++) {
      insertedCandidates.push({ ...result[j], _department: batch[j]._department });
    }
  }
  console.log(`Inserted ${insertedCandidates.length} candidates.\n`);

  // ── Generate scoring logs ──
  console.log("Generating scoring logs...");
  const scoringLogsToInsert: typeof schema.scoringLogs.$inferInsert[] = [];
  for (const cand of insertedCandidates) {
    if (cand.ai_score !== null) {
      scoringLogsToInsert.push({
        candidate_id: cand.id,
        provider: pick(["anthropic", "anthropic", "openai"]),
        model_version: pick(["claude-sonnet-4-20250514", "claude-sonnet-4-20250514", "gpt-4o-2024-08-06"]),
        full_prompt: `You are an expert recruitment assessor...\n\n## Role\n[role details]\n\n## CV\n[cv text redacted for seed data]\n\n## Instructions\nScore 1-10 on each dimension.`,
        full_response: JSON.stringify({
          overall_score: cand.ai_score,
          confidence: "medium",
          rationale: cand.ai_rationale,
          flags: [],
          recommendation: cand.ai_score >= 8.5 ? "strong_recommend" : cand.ai_score >= 7.5 ? "recommend" : cand.ai_score >= 6 ? "recommend_with_caveats" : cand.ai_score >= 5 ? "borderline" : "reject",
        }, null, 2),
        score: cand.ai_score,
        processing_time_ms: randInt(2800, 8500),
        scoring_type: "initial",
        dimensions: cand.ai_dimensions,
        confidence: cand.ai_confidence ?? "medium",
        rationale: cand.ai_rationale,
        flags: cand.ai_flags ?? [],
        recommendation: cand.ai_score >= 8.5 ? "strong_recommend" : cand.ai_score >= 7.5 ? "recommend" : cand.ai_score >= 6 ? "recommend_with_caveats" : cand.ai_score >= 5 ? "borderline" : "reject",
      });

      // Some follow_up candidates get a rescore
      if (cand.status === "follow_up" && rand() < 0.3) {
        const rescored = Math.round(normalScore(cand.ai_score + 0.5, 0.5) * 10) / 10;
        scoringLogsToInsert.push({
          candidate_id: cand.id,
          provider: "anthropic",
          model_version: "claude-sonnet-4-20250514",
          full_prompt: `You are an expert recruitment assessor. Re-evaluate with chat context...\n\n## Chat Transcript\n[redacted]\n\n## Previous Score: ${cand.ai_score}`,
          full_response: JSON.stringify({
            overall_score: rescored,
            confidence: "high",
            rationale: "Re-scored with additional context from candidate chat. Clarifications strengthened the assessment.",
            flags: [],
            recommendation: rescored >= 7.5 ? "recommend" : "recommend_with_caveats",
          }, null, 2),
          score: rescored,
          processing_time_ms: randInt(3200, 9000),
          scoring_type: "rescore_chat",
          dimensions: cand.ai_dimensions,
          confidence: "high",
          rationale: "Re-scored with additional context from candidate chat. Clarifications strengthened the assessment.",
          flags: [],
          recommendation: rescored >= 7.5 ? "recommend" : "recommend_with_caveats",
        });
      }
    }
  }
  for (let i = 0; i < scoringLogsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.scoringLogs).values(scoringLogsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${scoringLogsToInsert.length} scoring logs.\n`);

  // ── Generate email messages ──
  console.log("Generating messages...");
  const messagesToInsert: typeof schema.messages.$inferInsert[] = [];
  for (const cand of insertedCandidates) {
    // Application received email
    messagesToInsert.push({
      candidate_id: cand.id,
      channel: "email",
      direction: "outbound",
      content: "Application received — thank you for applying.",
      status: "sent",
      external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
    });

    // Gating result email
    if (cand.status === "gating_failed") {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "Application update — unfortunately we are unable to progress your application at this time.",
        status: "sent",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    } else if (cand.status !== "gating_passed") {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "Good news — your CV is being reviewed by our team.",
        status: "sent",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    }

    // Chat invitation emails for follow_up candidates
    if (cand.status === "follow_up") {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "We'd like to chat about your application — follow-up questions",
        status: "sent",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    }

    // Rejection emails for rejected candidates
    if (cand.status === "rejected") {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "Application update — after careful consideration, we've decided not to move forward.",
        status: "sent",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    }
  }
  for (let i = 0; i < messagesToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.messages).values(messagesToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${messagesToInsert.length} messages.\n`);

  // ── Generate conversations & chat messages for follow_up/withdrawn candidates ──
  console.log("Generating conversations and chat messages...");
  let conversationCount = 0;
  let chatMessageCount = 0;

  const followUpCandidates = insertedCandidates.filter(
    (c) => c.status === "follow_up" || c.status === "withdrawn"
  );

  for (const cand of followUpCandidates) {
    const flags = (cand.ai_flags ?? []) as string[];
    if (flags.length === 0) continue;

    const campaign = insertedCampaigns.find((c) => c.id === cand.campaign_id)!;
    const clientInfo = clientByCampaign.get(campaign.id)!;

    // Determine chat outcome
    const outcome: "all_covered" | "partial" | "withdrawn" =
      cand.status === "withdrawn"
        ? "withdrawn"
        : rand() < 0.4
          ? "all_covered"
          : "partial";

    const script = generateChatScript(
      cand.name,
      campaign.role_title,
      clientInfo.name,
      flags,
      outcome
    );

    // Build topic objects
    const topics = flags.map((flag, idx) => ({
      flag,
      topic: reframeFlag(flag),
      covered: outcome === "all_covered"
        ? true
        : outcome === "withdrawn"
          ? idx === 0
          : idx < Math.max(1, Math.floor(flags.length / 2)),
    }));
    const topicsCovered = topics.filter((t) => t.covered).length;

    const convStatus =
      outcome === "all_covered" && campaign.chat_lifecycle === "topics_complete"
        ? "closed"
        : outcome === "withdrawn"
          ? "closed"
          : rand() < 0.3
            ? "dormant"
            : "active";

    const closedReason =
      convStatus === "closed"
        ? outcome === "withdrawn"
          ? "candidate_withdrawn"
          : "topics_complete"
        : null;

    const convStartedMinutesAgo = randInt(120, 10000);
    const convCreatedAt = minutesAgo(convStartedMinutesAgo);

    const [conv] = await db.insert(schema.conversations).values({
      candidate_id: cand.id,
      status: convStatus,
      lifecycle: campaign.chat_lifecycle ?? "dormant",
      topics,
      topics_covered_count: topicsCovered,
      last_activity_at: minutesAgo(convStatus === "dormant" ? randInt(60, 200) : randInt(1, 60)),
      dormant_after_minutes: 30,
      closed_reason: closedReason,
      created_at: convCreatedAt,
      updated_at: new Date(),
    }).returning({ id: schema.conversations.id });

    conversationCount++;

    // Insert chat messages with staggered timestamps
    let msgTime = new Date(convCreatedAt);
    for (const msg of script.messages) {
      msgTime = new Date(msgTime.getTime() + randInt(15, 180) * 1000);
      await db.insert(schema.chatMessages).values({
        conversation_id: conv.id,
        role: msg.role,
        content: msg.content,
        created_at: msgTime,
      });
      chatMessageCount++;
    }
  }
  console.log(`Inserted ${conversationCount} conversations with ${chatMessageCount} chat messages.\n`);

  // ── Generate visitor events ──
  console.log("Generating visitor events...");
  const eventsToInsert: typeof schema.events.$inferInsert[] = [];
  const devices = ["desktop", "mobile", "tablet"] as const;
  const browsers = ["Chrome", "Safari", "Firefox", "Edge", "Samsung Internet"] as const;

  for (const campaign of insertedCampaigns) {
    if (campaign.status === "draft") continue;

    const visitorCount = campaign.status === "active" ? randInt(80, 250) : randInt(30, 100);

    for (let v = 0; v < visitorCount; v++) {
      const sessionId = `sess_${Math.random().toString(36).slice(2, 14)}`;
      const visitorId = rand() < 0.7 ? `vis_${Math.random().toString(36).slice(2, 14)}` : null;
      const device = pick(devices);
      const browser = pick(browsers);
      const eventDay = daysAgo(randInt(0, 30));

      // Page view
      eventsToInsert.push({
        campaign_id: campaign.id,
        event_type: "page_view",
        session_id: sessionId,
        visitor_id: visitorId,
        device_type: device,
        browser,
        metadata: { referrer: pick(["google", "linkedin", "direct", "indeed", "email", "twitter"]) },
        created_at: eventDay,
      });

      // Some visitors start the application
      if (rand() < 0.45) {
        eventsToInsert.push({
          campaign_id: campaign.id,
          event_type: "application_started",
          session_id: sessionId,
          visitor_id: visitorId,
          device_type: device,
          browser,
          created_at: new Date(eventDay.getTime() + randInt(30, 300) * 1000),
        });

        // Some complete it
        if (rand() < 0.65) {
          eventsToInsert.push({
            campaign_id: campaign.id,
            event_type: "application_submitted",
            session_id: sessionId,
            visitor_id: visitorId,
            device_type: device,
            browser,
            created_at: new Date(eventDay.getTime() + randInt(300, 900) * 1000),
          });
        }
      }
    }
  }
  for (let i = 0; i < eventsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.events).values(eventsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${eventsToInsert.length} events.\n`);

  // ── Generate completed jobs ──
  console.log("Generating job history...");
  const jobsToInsert: typeof schema.jobs.$inferInsert[] = [];

  for (const cand of insertedCandidates) {
    // Processing job
    if (cand.ai_score !== null) {
      const createdAt = daysAgo(randInt(1, 25));
      jobsToInsert.push({
        type: "candidate-processing",
        payload: { type: "candidate-processing", candidateId: cand.id },
        status: "completed",
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(5000, 15000)),
      });
    }

    // Email jobs
    if (cand.status === "gating_failed") {
      const createdAt = daysAgo(randInt(1, 20));
      jobsToInsert.push({
        type: "send-email",
        payload: { type: "send-email", candidateId: cand.id, emailKind: "gating_failed" },
        status: "completed",
        deliver_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000 + randInt(1000, 5000)),
        deduplication_id: `gating-failed-${cand.id}`,
      });
    }

    if (cand.status === "rejected") {
      const createdAt = daysAgo(randInt(1, 10));
      jobsToInsert.push({
        type: "send-email",
        payload: { type: "send-email", candidateId: cand.id, emailKind: "rejected" },
        status: "completed",
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(1000, 5000)),
        deduplication_id: `rejected-${cand.id}`,
      });
    }

    // Chat invitation jobs
    if (cand.status === "follow_up" || cand.status === "withdrawn") {
      const createdAt = daysAgo(randInt(1, 15));
      jobsToInsert.push({
        type: "send-chat-invitation",
        payload: { type: "send-chat-invitation", candidateId: cand.id },
        status: "completed",
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(2000, 8000)),
        deduplication_id: `chat-invite-${cand.id}`,
      });
    }

    // Rescore jobs for completed conversations
    if (cand.status === "follow_up" && rand() < 0.3) {
      const createdAt = daysAgo(randInt(1, 5));
      jobsToInsert.push({
        type: "rescore-after-chat",
        payload: { type: "rescore-after-chat", candidateId: cand.id, conversationId: "seed-placeholder" },
        status: "completed",
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(5000, 12000)),
        deduplication_id: `rescore-chat-${cand.id}`,
      });
    }
  }

  for (let i = 0; i < jobsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.jobs).values(jobsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${jobsToInsert.length} jobs.\n`);

  // ── Summary ──
  const [counts] = await db.select({
    clients: sql<number>`(select count(*) from clients)::int`,
    campaigns: sql<number>`(select count(*) from campaigns)::int`,
    candidates: sql<number>`(select count(*) from candidates)::int`,
    scoring_logs: sql<number>`(select count(*) from scoring_logs)::int`,
    messages: sql<number>`(select count(*) from messages)::int`,
    conversations: sql<number>`(select count(*) from conversations)::int`,
    chat_messages: sql<number>`(select count(*) from chat_messages)::int`,
    events: sql<number>`(select count(*) from events)::int`,
    jobs: sql<number>`(select count(*) from jobs)::int`,
  }).from(sql`(select 1) t`);

  console.log("=== Seed complete ===");
  console.log(`Clients:         ${counts.clients}`);
  console.log(`Campaigns:       ${counts.campaigns}`);
  console.log(`Candidates:      ${counts.candidates}`);
  console.log(`Scoring Logs:    ${counts.scoring_logs}`);
  console.log(`Messages:        ${counts.messages}`);
  console.log(`Conversations:   ${counts.conversations}`);
  console.log(`Chat Messages:   ${counts.chat_messages}`);
  console.log(`Events:          ${counts.events}`);
  console.log(`Jobs:            ${counts.jobs}`);

  await client.end();
}

// ── Helper: reframe flag for topic generation ──────────────────────

function reframeFlag(flag: string): string {
  const lower = flag.toLowerCase();
  if (lower.includes("tenure") || lower.includes("short stint"))
    return "Ask about their career transitions and what motivated their moves";
  if (lower.includes("gap") || lower.includes("break"))
    return "Ask about what they were doing during their career break and what they gained from it";
  if (lower.includes("overqualified"))
    return "Ask what excites them about this particular role and how they see it fitting their career goals";
  if (lower.includes("underqualified") || lower.includes("missing"))
    return "Ask how they've developed skills in areas adjacent to the requirements and their learning approach";
  if (lower.includes("relocation") || lower.includes("location"))
    return "Ask about their location preferences and flexibility";
  if (lower.includes("salary") || lower.includes("compensation"))
    return "Ask about their expectations for the role and what they value in a position";
  if (lower.includes("title") || lower.includes("inconsistent"))
    return "Ask about the scope and responsibilities in their most recent roles";
  return `Ask about: ${flag}`;
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
