import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { pathToFileURL } from "url";
import bcrypt from "bcryptjs";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";
import { isStorageConfigured, uploadCV } from "../lib/azure-storage";
import { namespaceDedup } from "../lib/queue/types";
// Pure, alias-free modules (safe under tsx): the colour engine + font registry the
// gallery catalogue derives its palettes/stacks from — the same ones the builder uses.
import { derivePalette } from "../lib/theme-colors";
import { resolveBodyFont, resolveDisplayFont } from "../lib/theme-fonts";
import {
  DEMO_ORGS,
  DEMO_USERS,
  buildMembershipRows,
  type CastUserWithId,
} from "./seed-cast";

type Db = PostgresJsDatabase<typeof schema>;

/** Build a tiny but valid single-page PDF so seeded CVs resolve to a real,
 *  previewable blob (S6 Resolved Decision 2). */
function buildSamplePdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 36 96 Td (${text}) Tj ET`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── Deterministic random ─────────────────────────────────────────────
// A seeded LCG so a re-run reproduces identical data (and identical counts —
// the re-runnability acceptance). resetRandom() is called at the start of every
// seed() so the function is deterministic whether invoked by the CLI or a test.

let rngState = 42;
function resetRandom(): void {
  rngState = 42;
}
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
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

// ── Brand colour palettes ────────────────────────────────────────────
// Keyed by the `branding` field on each DEMO_ORGS brand. Distinct per brand so
// the demo's careers pages look visually different across divisions.

const BRANDING: Record<
  string,
  {
    brand_primary_color: string;
    brand_secondary_color: string;
    brand_accent_color: string;
    brand_text_color: string;
    logo_background: string;
    logo_position: string;
  }
> = {
  emerald: {
    brand_primary_color: "#006341", brand_secondary_color: "#f2f7f4",
    brand_accent_color: "#b4c905", brand_text_color: "#0b1f14",
    logo_background: "light", logo_position: "top-left",
  },
  azure: {
    brand_primary_color: "#00457c", brand_secondary_color: "#eef3f8",
    brand_accent_color: "#ff6b00", brand_text_color: "#0b1424",
    logo_background: "light", logo_position: "top-left",
  },
  forest: {
    brand_primary_color: "#00573c", brand_secondary_color: "#f3f5f2",
    brand_accent_color: "#9a8250", brand_text_color: "#0b1414",
    logo_background: "light", logo_position: "top-left",
  },
  navy: {
    brand_primary_color: "#003057", brand_secondary_color: "#f2f4f7",
    brand_accent_color: "#e4b80e", brand_text_color: "#0b1424",
    logo_background: "light", logo_position: "top-centre",
  },
  amber: {
    brand_primary_color: "#ffcc00", brand_secondary_color: "#1a1a1a",
    brand_accent_color: "#ff6b00", brand_text_color: "#1a1a1a",
    logo_background: "dark", logo_position: "top-left",
  },
};

// ── Source data ──────────────────────────────────────────────────────

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

// ── Demo password (single shared credential, guarded in production) ───
// Decision F: one SEED_DEMO_PASSWORD hashed once and applied to every demo
// user (and the operator). Mirrors seed-admin.ts's requirePassword guard —
// refuses a weak/missing value under NODE_ENV=production.

const DEFAULT_DEMO_PASSWORD = "demo-password-1234";

function resolveDemoPassword(): string {
  const v = process.env.SEED_DEMO_PASSWORD?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!v || v.length < 12) {
      throw new Error(
        "Refusing to seed demo users in production: set SEED_DEMO_PASSWORD to a strong (12+ char) value."
      );
    }
    return v;
  }
  // Non-production: allow a sensible default so `npm run db:seed` works out of
  // the box. A provided value still wins (and must be ≥8 chars to be honoured).
  return v && v.length >= 8 ? v : DEFAULT_DEMO_PASSWORD;
}

// ── Seed summary ─────────────────────────────────────────────────────

export interface SeedSummary {
  orgs: number;
  brands: number;
  users: number;
  memberships: number;
  campaigns: number;
  candidates: number;
  scoringLogs: number;
  messages: number;
  conversations: number;
  chatMessages: number;
  events: number;
  jobs: number;
  usageEvents: number;
  usageByKind: Record<string, number>;
}

// ── Main seed function (exported so a verify test can run it on a throwaway DB) ──

const BATCH_SIZE = 500;

export async function seed(db: Db): Promise<SeedSummary> {
  resetRandom();
  console.log("Seeding database (two-org demo)...\n");

  // ── Clear existing data in dependency order ──
  // Full deterministic rebuild. Operators are PRESERVED (find-or-created by
  // email below) so a re-run keeps their UUIDs stable; every other demo row is
  // wiped and regenerated. Order respects FKs; usage_events/memberships/
  // invitations are cleared explicitly for legibility even though they cascade.
  console.log("Clearing existing demo data...");
  await db.delete(schema.chatMessages);
  await db.delete(schema.conversations);
  await db.delete(schema.chatTokens);
  await db.delete(schema.events);
  await db.delete(schema.jobs);
  await db.delete(schema.usageEvents);
  await db.delete(schema.scoringLogs);
  await db.delete(schema.messages);
  await db.delete(schema.candidates);
  await db.delete(schema.campaigns);
  await db.delete(schema.invitations);
  await db.delete(schema.memberships);
  await db.delete(schema.passwordResetTokens);
  // Themes (CT1) — gallery rows have null org_id/client_id so they do NOT cascade
  // when clients/orgs are dropped; clear them explicitly for a clean rebuild.
  await db.delete(schema.themes);
  // Keep operators; drop all tenant users (operator_audit only references
  // operators, so this never trips its not-null set-null FK).
  await db.delete(schema.users).where(eq(schema.users.is_operator, false));
  await db.delete(schema.clients);
  console.log("Done.\n");

  // ── Organizations (find-or-create by slug; durable top-level rows) ──
  const orgIdBySlug = new Map<string, string>();
  for (const o of DEMO_ORGS) {
    const existing = await db.query.organizations.findFirst({
      where: eq(schema.organizations.slug, o.slug),
      columns: { id: true },
    });
    if (existing) {
      await db
        .update(schema.organizations)
        .set({ name: o.name, status: "active" })
        .where(eq(schema.organizations.id, existing.id));
      orgIdBySlug.set(o.slug, existing.id);
    } else {
      const [inserted] = await db
        .insert(schema.organizations)
        .values({ slug: o.slug, name: o.name, status: "active" })
        .returning({ id: schema.organizations.id });
      orgIdBySlug.set(o.slug, inserted.id);
    }
  }
  console.log(`Organizations: ${orgIdBySlug.size} (${DEMO_ORGS.map((o) => o.slug).join(", ")})`);

  // ── Plans (usage-based pricing config; docs/pricing-model.md §4) ──
  // Reference config keyed by org tier. No inbound FKs, so a clean delete+insert
  // keeps the numbers in sync on every re-seed. Credit sell price is global
  // (CREDIT_PRICE_ZAR in src/lib/pricing.ts), not stored here.
  await db.delete(schema.plans);
  await db.insert(schema.plans).values([
    // Standard & Premium advertise openly; Enterprise is shown but its
    // commercials are negotiated, so show_pricing is off (card renders a
    // "let's talk" CTA instead of price/credits). All three are public_visible
    // by default — operators hide any of them from /operator/plans.
    { tier: "standard", base_fee_zar: 7500, included_credits: 6000, overage_discount_pct: 0 },
    { tier: "premium", base_fee_zar: 18000, included_credits: 18000, overage_discount_pct: 10 },
    { tier: "enterprise", base_fee_zar: 36000, included_credits: 45000, overage_discount_pct: 25, show_pricing: false },
  ]);
  console.log("Plans: 3 (standard, premium, enterprise)");

  // ── Invoice counter (gapless invoice_no) ──
  // Singleton row id=1. The billing-close txn SELECT … FOR UPDATEs it. Reset to 1
  // on re-seed (the delete+insert below also clears any invoices in a fresh DB).
  await db.delete(schema.invoiceCounters);
  await db.insert(schema.invoiceCounters).values({ id: 1, next_seq: 1 });
  console.log("Invoice counter: initialised (next_seq=1)");

  // ── Brands (clients) — globally-distinct slugs (S12 contract) ──
  const brandRows: { id: string; slug: string; name: string; orgId: string }[] = [];
  for (const o of DEMO_ORGS) {
    const orgId = orgIdBySlug.get(o.slug)!;
    const inserted = await db
      .insert(schema.clients)
      .values(
        o.brands.map((b) => ({
          org_id: orgId,
          slug: b.slug,
          name: b.name,
          contact_name: b.contact_name,
          contact_email: b.contact_email,
          contact_phone: b.contact_phone,
          billing_email: b.billing_email,
          notes: b.notes,
          is_active: true,
          ...BRANDING[b.branding],
        }))
      )
      .returning({ id: schema.clients.id, slug: schema.clients.slug, name: schema.clients.name });
    for (const r of inserted) brandRows.push({ ...r, orgId });
  }
  const brandIdBySlug = new Map(brandRows.map((b) => [b.slug, b.id]));
  const brandNameById = new Map(brandRows.map((b) => [b.id, b.name]));
  console.log(`Brands: ${brandRows.length} (${brandRows.map((b) => b.slug).join(", ")})\n`);

  // ── One sample CV per org (S6 Resolved Decision 2) ──
  // org-scoped blob path cvs/{orgId}/{brandSlug}/{candidateId}. When storage is
  // not configured every seeded cv_url stays null (cv_text still drives scoring).
  const sampleCvByOrg = new Map<string, string | null>();
  if (isStorageConfigured()) {
    for (const [slug, orgId] of orgIdBySlug) {
      const path = await uploadCV(
        orgId,
        "_sample",
        "shared",
        buildSamplePdf(`Sample CV — ${slug}`),
        "sample.pdf"
      );
      sampleCvByOrg.set(orgId, path);
    }
    console.log("Uploaded one sample CV per org.");
  } else {
    console.log("Storage not configured — seeded cv_url will be null.");
  }
  const cvUrlFor = (orgId: string): string | null => sampleCvByOrg.get(orgId) ?? null;

  // ── Users + memberships ──
  const passwordHash = await bcrypt.hash(resolveDemoPassword(), 12);

  // Operator — find-or-create by email so the UUID is stable across re-runs.
  const operatorDef = DEMO_USERS.find((u) => u.isOperator)!;
  const existingOperator = await db.query.users.findFirst({
    where: eq(schema.users.email, operatorDef.email),
    columns: { id: true },
  });
  let operatorId: string;
  if (!existingOperator) {
    const [inserted] = await db
      .insert(schema.users)
      .values({
        org_id: null,
        org_role: null,
        is_operator: true,
        first_name: operatorDef.firstName,
        last_name: operatorDef.lastName,
        email: operatorDef.email,
        password_hash: passwordHash,
        is_active: true,
      })
      .returning({ id: schema.users.id, org_id: schema.users.org_id });
    if (inserted.org_id !== null) {
      throw new Error(
        `Operator ${operatorDef.email} was created with a non-NULL org_id; expected an explicit NULL org binding.`
      );
    }
    operatorId = inserted.id;
  } else {
    // Keep the credential current on a re-run.
    await db
      .update(schema.users)
      .set({ password_hash: passwordHash, is_active: true })
      .where(eq(schema.users.id, existingOperator.id));
    operatorId = existingOperator.id;
  }

  // Tenant users — the shared email appears twice (different org_id), one active
  // and one inactive (Decision E). buildMembershipRows enforces the grant rules.
  const tenantDefs = DEMO_USERS.filter((u) => !u.isOperator);
  const castWithId: CastUserWithId[] = [];
  for (const u of tenantDefs) {
    const orgId = orgIdBySlug.get(u.orgSlug!)!;
    const [inserted] = await db
      .insert(schema.users)
      .values({
        org_id: orgId,
        org_role: u.orgRole,
        is_operator: false,
        first_name: u.firstName,
        last_name: u.lastName,
        email: u.email,
        password_hash: passwordHash,
        is_active: u.isActive,
      })
      .returning({ id: schema.users.id });
    castWithId.push({
      id: inserted.id,
      email: u.email,
      orgRole: u.orgRole,
      isOperator: false,
      memberships: u.memberships,
    });
  }

  const membershipRows = buildMembershipRows(castWithId, brandIdBySlug);
  if (membershipRows.length > 0) {
    await db.insert(schema.memberships).values(membershipRows);
  }
  console.log(
    `Users: ${tenantDefs.length} tenant + 1 operator; Memberships: ${membershipRows.length}\n`
  );

  // ── Gallery theme catalogue (Campaign Themes) ──
  // The predefined set Standard subscribers pick from: ONE shared layout in a
  // range of distinct colour ways (the owner's "same theme, different colours").
  // Each is authored from 3 seeds — derivePalette builds the contrast-checked
  // 11-token palette — plus a deliberate font pairing, so an operator can re-edit
  // any of them in the theme builder. "TalentStream Classic" reproduces today's
  // default look. derivePalette / the font registry are imported by RELATIVE path
  // (both pure, no `@/` alias) so this stays tsx-safe. No brand's default_theme_id
  // is pointed at any of these — they exist so tenants have a set to pick from.
  const GALLERY_CATALOGUE: {
    name: string;
    seeds: { primary: string; accent: string; bg: string };
    displayKey: string;
    bodyKey: string;
  }[] = [
    {
      name: "TalentStream Classic",
      seeds: { primary: "#2c5bff", accent: "#05dbd6", bg: "#f0f3f7" },
      displayKey: "instrument-serif",
      bodyKey: "instrument-sans",
    },
    {
      name: "Terracotta",
      seeds: { primary: "#b5532f", accent: "#2c6e6b", bg: "#f7f1e9" },
      displayKey: "dm-serif-display",
      bodyKey: "work-sans",
    },
    {
      name: "Forest",
      seeds: { primary: "#1f6f54", accent: "#c9a227", bg: "#f3f6f3" },
      displayKey: "playfair-display",
      bodyKey: "source-sans-3",
    },
    {
      name: "Plum",
      seeds: { primary: "#6b2d5c", accent: "#d98cae", bg: "#faf6f8" },
      displayKey: "libre-baskerville",
      bodyKey: "dm-sans",
    },
    {
      name: "Slate & Coral",
      seeds: { primary: "#33415c", accent: "#ff6b5e", bg: "#f4f5f6" },
      displayKey: "space-grotesk",
      bodyKey: "inter",
    },
    {
      name: "Midnight",
      seeds: { primary: "#3b5bdb", accent: "#f5b945", bg: "#14161c" },
      displayKey: "fraunces",
      bodyKey: "work-sans",
    },
  ];

  await db.insert(schema.themes).values(
    GALLERY_CATALOGUE.map((t) => ({
      org_id: null,
      client_id: null,
      name: t.name,
      scope: "gallery" as const,
      is_active: true,
      seed_primary: t.seeds.primary,
      seed_accent: t.seeds.accent,
      seed_bg: t.seeds.bg,
      palette: derivePalette(t.seeds),
      font_display: resolveDisplayFont(t.displayKey).stack,
      font_sans: resolveBodyFont(t.bodyKey).stack,
      font_display_key: t.displayKey,
      font_body_key: t.bodyKey,
      logo_url: null,
      logo_background: "light",
      logo_position: "top-left",
      show_powered_by: true,
      landing_html: null,
      email_shell: null,
      preview_image_url: null,
      created_by: operatorId,
    }))
  );
  console.log(
    `Gallery themes: ${GALLERY_CATALOGUE.length} (${GALLERY_CATALOGUE.map((t) => t.name).join(", ")})\n`
  );

  // Accumulator for metered usage events (awaited + batched at the end).
  const usageEventsToInsert: (typeof schema.usageEvents.$inferInsert)[] = [];

  // ── Campaigns — 2–4 per brand ──
  console.log("Generating campaigns...");
  const campaignsToInsert: (typeof schema.campaigns.$inferInsert)[] = [];
  for (const brand of brandRows) {
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

      const campaignStart =
        status === "active" || status === "paused" || status === "closed"
          ? daysAgo(randInt(5, 45))
          : null;
      const campaignEnd = status === "closed" ? daysAgo(randInt(1, 10)) : null;
      const createdAt = campaignStart ?? daysAgo(randInt(5, 45));

      campaignsToInsert.push({
        org_id: brand.orgId,
        client_id: brand.id,
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
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  }

  const insertedCampaigns = await db.insert(schema.campaigns).values(campaignsToInsert).returning({
    id: schema.campaigns.id,
    slug: schema.campaigns.slug,
    client_id: schema.campaigns.client_id,
    org_id: schema.campaigns.org_id,
    status: schema.campaigns.status,
    role_title: schema.campaigns.role_title,
    department: schema.campaigns.department,
    gating_config: schema.campaigns.gating_config,
    chat_lifecycle: schema.campaigns.chat_lifecycle,
    created_at: schema.campaigns.created_at,
  });

  // campaign_id → its brand + org + created_at (used to stamp downstream usage).
  const campaignMeta = new Map<string, { clientId: string; orgId: string; createdAt: Date }>();
  for (const camp of insertedCampaigns) {
    campaignMeta.set(camp.id, {
      clientId: camp.client_id,
      orgId: camp.org_id,
      createdAt: camp.created_at,
    });
    // usage: one campaign_created per campaign (mirrors campaigns POST).
    usageEventsToInsert.push({
      org_id: camp.org_id,
      brand_id: camp.client_id,
      kind: "campaign_created",
      campaign_id: camp.id,
      created_at: camp.created_at,
    });
  }
  console.log(`Inserted ${insertedCampaigns.length} campaigns.\n`);

  // ── Candidates ──
  console.log("Generating candidates...");
  const candidatesToInsert: (typeof schema.candidates.$inferInsert & { _department: string })[] = [];

  for (const campaign of insertedCampaigns) {
    if (campaign.status === "draft") continue;

    const candidateCount =
      campaign.status === "closed"
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
        // Every seeded candidate lands in a terminal, already-scored state. We
        // never seed `gating_passed` or `scoring`: the jobs processor's recovery
        // loop re-enqueues candidates in those statuses on startup and would run
        // real AI scoring against seed data — burning credits to recompute work
        // that's already represented here. (`follow_up` is safe: it's scored,
        // carries a completed processing job, and the recovery loop ignores it.)
        const scoreBucket = weighted([
          { value: "scored", weight: 50 },
          { value: "follow_up", weight: 20 },
          { value: "shortlisted", weight: 15 },
          { value: "rejected", weight: 10 },
          { value: "withdrawn", weight: 5 },
        ]);
        status = scoreBucket;

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
        org_id: campaign.org_id,
        campaign_id: campaign.id,
        name,
        email,
        phone,
        whatsapp_opted_in: rand() < 0.6,
        gating_answers: answers,
        gating_passed: gatingPassed,
        cv_url: hasCv ? cvUrlFor(campaign.org_id) : null,
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
  const insertedCandidates: {
    id: string; campaign_id: string; org_id: string; status: string; email: string;
    name: string; ai_score: number | null; ai_rationale: string | null;
    ai_dimensions: unknown; ai_confidence: string | null; ai_flags: unknown;
    created_at: Date; _department: string;
  }[] = [];

  for (let i = 0; i < candidatesToInsert.length; i += BATCH_SIZE) {
    const batch = candidatesToInsert.slice(i, i + BATCH_SIZE);
    // Strip the helper field before inserting
    const cleanBatch = batch.map(({ _department, ...rest }) => rest);
    const result = await db.insert(schema.candidates).values(cleanBatch).returning({
      id: schema.candidates.id,
      campaign_id: schema.candidates.campaign_id,
      org_id: schema.candidates.org_id,
      status: schema.candidates.status,
      email: schema.candidates.email,
      name: schema.candidates.name,
      ai_score: schema.candidates.ai_score,
      ai_rationale: schema.candidates.ai_rationale,
      ai_dimensions: schema.candidates.ai_dimensions,
      ai_confidence: schema.candidates.ai_confidence,
      ai_flags: schema.candidates.ai_flags,
      created_at: schema.candidates.created_at,
    });
    // Re-attach the department for downstream use
    for (let j = 0; j < result.length; j++) {
      insertedCandidates.push({ ...result[j], _department: batch[j]._department });
    }
  }
  // usage: one candidate_created per candidate (mirrors apply route).
  for (const cand of insertedCandidates) {
    usageEventsToInsert.push({
      org_id: cand.org_id,
      brand_id: campaignMeta.get(cand.campaign_id)!.clientId,
      kind: "candidate_created",
      campaign_id: cand.campaign_id,
      candidate_id: cand.id,
      created_at: cand.created_at,
    });
  }
  console.log(`Inserted ${insertedCandidates.length} candidates.\n`);

  // ── Scoring logs (+ ai_tokens usage) ──
  console.log("Generating scoring logs...");
  const scoringLogsToInsert: (typeof schema.scoringLogs.$inferInsert)[] = [];
  for (const cand of insertedCandidates) {
    if (cand.ai_score === null) continue;

    const provider = pick(["anthropic", "anthropic", "openai"]);
    const model = provider === "openai" ? "gpt-4o-2024-08-06" : "claude-sonnet-4-6";
    const brandId = campaignMeta.get(cand.campaign_id)!.clientId;
    const scoredAt = new Date(cand.created_at.getTime() + randInt(2, 30) * 60_000);

    scoringLogsToInsert.push({
      org_id: cand.org_id,
      candidate_id: cand.id,
      provider,
      model_version: model,
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
      flags: (cand.ai_flags as string[] | null) ?? [],
      recommendation: cand.ai_score >= 8.5 ? "strong_recommend" : cand.ai_score >= 7.5 ? "recommend" : cand.ai_score >= 6 ? "recommend_with_caveats" : cand.ai_score >= 5 ? "borderline" : "reject",
      created_at: scoredAt,
      updated_at: scoredAt,
    });
    usageEventsToInsert.push({
      org_id: cand.org_id,
      brand_id: brandId,
      kind: "ai_tokens",
      provider,
      model,
      model_tier: "professional", // sonnet-4-6 / gpt-4o both map to professional
      input_tokens: randInt(1500, 6000),
      output_tokens: randInt(200, 900),
      campaign_id: cand.campaign_id,
      candidate_id: cand.id,
      created_at: scoredAt,
    });

    // Some follow_up candidates get a rescore (with its own ai_tokens row).
    if (cand.status === "follow_up" && rand() < 0.3) {
      const rescored = Math.round(normalScore(cand.ai_score + 0.5, 0.5) * 10) / 10;
      const rescoreAt = new Date(scoredAt.getTime() + randInt(1, 3) * 24 * 60 * 60_000);
      scoringLogsToInsert.push({
        org_id: cand.org_id,
        candidate_id: cand.id,
        provider: "anthropic",
        model_version: "claude-sonnet-4-6",
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
        created_at: rescoreAt,
        updated_at: rescoreAt,
      });
      usageEventsToInsert.push({
        org_id: cand.org_id,
        brand_id: brandId,
        kind: "ai_tokens",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        model_tier: "professional",
        input_tokens: randInt(1500, 6000),
        output_tokens: randInt(200, 900),
        campaign_id: cand.campaign_id,
        candidate_id: cand.id,
        created_at: rescoreAt,
      });
    }
  }
  for (let i = 0; i < scoringLogsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.scoringLogs).values(scoringLogsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${scoringLogsToInsert.length} scoring logs.\n`);

  // ── Email messages (+ email_sent usage; one per outbound message) ──
  console.log("Generating messages...");
  const messagesToInsert: (typeof schema.messages.$inferInsert)[] = [];
  for (const cand of insertedCandidates) {
    const brandId = campaignMeta.get(cand.campaign_id)!.clientId;
    const pushMessage = (content: string, offsetMinutes: number) => {
      const createdAt = new Date(cand.created_at.getTime() + offsetMinutes * 60_000);
      messagesToInsert.push({
        org_id: cand.org_id,
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content,
        status: "sent",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
        created_at: createdAt,
        updated_at: createdAt,
      });
      usageEventsToInsert.push({
        org_id: cand.org_id,
        brand_id: brandId,
        kind: "email_sent",
        campaign_id: cand.campaign_id,
        candidate_id: cand.id,
        created_at: createdAt,
      });
    };

    // Application received email
    pushMessage("Application received — thank you for applying.", 5);

    // Gating result email
    if (cand.status === "gating_failed") {
      pushMessage("Application update — unfortunately we are unable to progress your application at this time.", 60);
    } else {
      pushMessage("Good news — your CV is being reviewed by our team.", 60);
    }

    // Chat invitation emails for follow_up candidates
    if (cand.status === "follow_up") {
      pushMessage("We'd like to chat about your application — follow-up questions", 120);
    }

    // Rejection emails for rejected candidates
    if (cand.status === "rejected") {
      pushMessage("Application update — after careful consideration, we've decided not to move forward.", 240);
    }
  }
  for (let i = 0; i < messagesToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.messages).values(messagesToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${messagesToInsert.length} messages.\n`);

  // ── Conversations & chat messages (+ chat_message usage for user turns) ──
  console.log("Generating conversations and chat messages...");
  const chatMessagesToInsert: (typeof schema.chatMessages.$inferInsert)[] = [];
  let conversationCount = 0;

  const followUpCandidates = insertedCandidates.filter(
    (c) => c.status === "follow_up" || c.status === "withdrawn"
  );

  for (const cand of followUpCandidates) {
    const flags = (cand.ai_flags ?? []) as string[];
    if (flags.length === 0) continue;

    const meta = campaignMeta.get(cand.campaign_id)!;
    const campaign = insertedCampaigns.find((c) => c.id === cand.campaign_id)!;
    const companyName = brandNameById.get(meta.clientId) ?? "the company";

    // Determine chat outcome
    const outcome: "all_covered" | "partial" | "withdrawn" =
      cand.status === "withdrawn"
        ? "withdrawn"
        : rand() < 0.4
          ? "all_covered"
          : "partial";

    const script = generateChatScript(cand.name, campaign.role_title, companyName, flags, outcome);

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
      org_id: cand.org_id,
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

    // Accumulate chat messages with staggered timestamps; user turns meter.
    let msgTime = new Date(convCreatedAt);
    for (const msg of script.messages) {
      msgTime = new Date(msgTime.getTime() + randInt(15, 180) * 1000);
      chatMessagesToInsert.push({
        org_id: cand.org_id,
        conversation_id: conv.id,
        role: msg.role,
        content: msg.content,
        created_at: msgTime,
      });
      if (msg.role === "user") {
        usageEventsToInsert.push({
          org_id: cand.org_id,
          brand_id: meta.clientId,
          kind: "chat_message",
          campaign_id: cand.campaign_id,
          candidate_id: cand.id,
          created_at: msgTime,
        });
      }
    }
  }
  for (let i = 0; i < chatMessagesToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.chatMessages).values(chatMessagesToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${conversationCount} conversations with ${chatMessagesToInsert.length} chat messages.\n`);

  // ── Visitor events — the production analytics funnel vocabulary ──
  // page_view → form_start → field_interact → (form_submit | form_abandon).
  // Matches ALLOWED_EVENT_TYPES (api/events) and what analytics/route.ts reads,
  // so the seeded analytics dashboards populate instead of showing zeroes.
  console.log("Generating visitor events...");
  const eventsToInsert: (typeof schema.events.$inferInsert)[] = [];
  const devices = ["desktop", "mobile", "tablet"] as const;
  const browsers = ["Chrome", "Safari", "Firefox", "Edge", "Samsung Internet"] as const;
  const FORM_FIELDS = ["full_name", "email", "phone", "experience", "work_authorisation", "notice_period", "cv_upload"] as const;

  for (const campaign of insertedCampaigns) {
    if (campaign.status === "draft") continue;

    const visitorCount = campaign.status === "active" ? randInt(80, 250) : randInt(30, 100);

    for (let v = 0; v < visitorCount; v++) {
      const sessionId = `sess_${Math.random().toString(36).slice(2, 14)}`;
      const visitorId = rand() < 0.7 ? `vis_${Math.random().toString(36).slice(2, 14)}` : null;
      const device = pick(devices);
      const browser = pick(browsers);
      const eventDay = daysAgo(randInt(0, 30));
      const base = {
        org_id: campaign.org_id,
        campaign_id: campaign.id,
        session_id: sessionId,
        visitor_id: visitorId,
        device_type: device,
        browser,
      };

      // Page view
      eventsToInsert.push({
        ...base,
        event_type: "page_view",
        metadata: { referrer: pick(["google", "linkedin", "direct", "indeed", "email", "twitter"]) },
        created_at: eventDay,
      });

      // Some visitors start the application form
      if (rand() < 0.45) {
        let t = eventDay.getTime() + randInt(20, 120) * 1000;
        eventsToInsert.push({ ...base, event_type: "form_start", created_at: new Date(t) });

        const reached = randInt(1, FORM_FIELDS.length);
        for (let f = 0; f < reached; f++) {
          t += randInt(10, 60) * 1000;
          eventsToInsert.push({
            ...base,
            event_type: "field_interact",
            metadata: { field: FORM_FIELDS[f] },
            created_at: new Date(t),
          });
        }

        t += randInt(15, 120) * 1000;
        // Most who start, submit; the rest abandon at the last field they touched.
        if (rand() < 0.65) {
          eventsToInsert.push({ ...base, event_type: "form_submit", created_at: new Date(t) });
        } else {
          eventsToInsert.push({
            ...base,
            event_type: "form_abandon",
            metadata: { last_field: FORM_FIELDS[reached - 1] },
            created_at: new Date(t),
          });
        }
      }
    }
  }
  for (let i = 0; i < eventsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.events).values(eventsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${eventsToInsert.length} events.\n`);

  // ── Completed jobs — stamped org_id + org-namespaced dedup (mirror S10) ──
  console.log("Generating job history...");
  const jobsToInsert: (typeof schema.jobs.$inferInsert)[] = [];

  for (const cand of insertedCandidates) {
    // Processing job
    if (cand.ai_score !== null) {
      const createdAt = daysAgo(randInt(1, 25));
      jobsToInsert.push({
        type: "candidate-processing",
        payload: { type: "candidate-processing", candidateId: cand.id },
        status: "completed",
        org_id: cand.org_id,
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(5000, 15000)),
        deduplication_id: namespaceDedup(cand.org_id, `candidate-processing-${cand.id}`),
      });
    }

    // Email jobs
    if (cand.status === "gating_failed") {
      const createdAt = daysAgo(randInt(1, 20));
      jobsToInsert.push({
        type: "send-email",
        payload: { type: "send-email", candidateId: cand.id, emailKind: "gating_failed" },
        status: "completed",
        org_id: cand.org_id,
        deliver_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000 + randInt(1000, 5000)),
        deduplication_id: namespaceDedup(cand.org_id, `gating-failed-${cand.id}`),
      });
    }

    if (cand.status === "rejected") {
      const createdAt = daysAgo(randInt(1, 10));
      jobsToInsert.push({
        type: "send-email",
        payload: { type: "send-email", candidateId: cand.id, emailKind: "rejected" },
        status: "completed",
        org_id: cand.org_id,
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(1000, 5000)),
        deduplication_id: namespaceDedup(cand.org_id, `rejected-${cand.id}`),
      });
    }

    // Chat invitation jobs
    if (cand.status === "follow_up" || cand.status === "withdrawn") {
      const createdAt = daysAgo(randInt(1, 15));
      jobsToInsert.push({
        type: "send-chat-invitation",
        payload: { type: "send-chat-invitation", candidateId: cand.id },
        status: "completed",
        org_id: cand.org_id,
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(2000, 8000)),
        deduplication_id: namespaceDedup(cand.org_id, `chat-invite-${cand.id}`),
      });
    }

    // Rescore jobs for completed conversations
    if (cand.status === "follow_up" && rand() < 0.3) {
      const createdAt = daysAgo(randInt(1, 5));
      jobsToInsert.push({
        type: "rescore-after-chat",
        payload: { type: "rescore-after-chat", candidateId: cand.id, conversationId: "seed-placeholder" },
        status: "completed",
        org_id: cand.org_id,
        deliver_at: createdAt,
        attempts: 1,
        max_attempts: 3,
        created_at: createdAt,
        completed_at: new Date(createdAt.getTime() + randInt(5000, 12000)),
        deduplication_id: namespaceDedup(cand.org_id, `rescore-chat-${cand.id}`),
      });
    }
  }

  for (let i = 0; i < jobsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.jobs).values(jobsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${jobsToInsert.length} jobs.\n`);

  // ── Usage events — awaited + batched (not fire-and-forget) ──
  console.log("Recording usage events...");
  for (let i = 0; i < usageEventsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.usageEvents).values(usageEventsToInsert.slice(i, i + BATCH_SIZE));
  }
  const usageByKind = usageEventsToInsert.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Inserted ${usageEventsToInsert.length} usage events.\n`);

  // ── End-of-seed verification (build-time guarantee of "0 mismatches") ──
  await verifyTenantIntegrity(db);

  return {
    orgs: orgIdBySlug.size,
    brands: brandRows.length,
    users: tenantDefs.length + 1,
    memberships: membershipRows.length,
    campaigns: insertedCampaigns.length,
    candidates: insertedCandidates.length,
    scoringLogs: scoringLogsToInsert.length,
    messages: messagesToInsert.length,
    conversations: conversationCount,
    chatMessages: chatMessagesToInsert.length,
    events: eventsToInsert.length,
    jobs: jobsToInsert.length,
    usageEvents: usageEventsToInsert.length,
    usageByKind,
  };
}

// ── Tenant-integrity verification ────────────────────────────────────
// Throws if any leaf row has a NULL org_id, or any leaf's org_id disagrees with
// its parent's. This makes the "0 org_id mismatches" acceptance a hard, in-script
// guarantee rather than a manual check.

async function verifyTenantIntegrity(db: Db): Promise<void> {
  const problems: string[] = [];

  const scalar = async (query: SQL): Promise<number> => {
    const rows = (await db.execute(query)) as unknown as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  };

  // Every leaf table carries a denormalised org_id — none may be NULL.
  const leafTables = [
    "clients", "campaigns", "candidates", "scoring_logs", "messages",
    "conversations", "chat_messages", "chat_tokens", "events", "usage_events",
  ];
  for (const name of leafTables) {
    const n = await scalar(sql`select count(*)::int as n from ${sql.raw(name)} where org_id is null`);
    if (n > 0) problems.push(`${name}: ${n} row(s) with NULL org_id`);
  }

  const parentChecks: { label: string; query: SQL }[] = [
    { label: "candidates.org_id ≠ campaign.org_id", query: sql`select count(*)::int as n from candidates c join campaigns p on c.campaign_id = p.id where c.org_id <> p.org_id` },
    { label: "scoring_logs.org_id ≠ candidate.org_id", query: sql`select count(*)::int as n from scoring_logs s join candidates p on s.candidate_id = p.id where s.org_id <> p.org_id` },
    { label: "messages.org_id ≠ candidate.org_id", query: sql`select count(*)::int as n from messages m join candidates p on m.candidate_id = p.id where m.org_id <> p.org_id` },
    { label: "conversations.org_id ≠ candidate.org_id", query: sql`select count(*)::int as n from conversations co join candidates p on co.candidate_id = p.id where co.org_id <> p.org_id` },
    { label: "chat_messages.org_id ≠ conversation.org_id", query: sql`select count(*)::int as n from chat_messages cm join conversations p on cm.conversation_id = p.id where cm.org_id <> p.org_id` },
    { label: "events.org_id ≠ campaign.org_id", query: sql`select count(*)::int as n from events e join campaigns p on e.campaign_id = p.id where e.org_id <> p.org_id` },
    { label: "campaigns.org_id ≠ brand.org_id", query: sql`select count(*)::int as n from campaigns c join clients p on c.client_id = p.id where c.org_id <> p.org_id` },
    { label: "usage_events.org_id ≠ campaign.org_id", query: sql`select count(*)::int as n from usage_events u join campaigns p on u.campaign_id = p.id where u.org_id <> p.org_id` },
    { label: "usage_events.org_id ≠ candidate.org_id", query: sql`select count(*)::int as n from usage_events u join candidates p on u.candidate_id = p.id where u.org_id <> p.org_id` },
    { label: "usage_events.org_id ≠ brand.org_id", query: sql`select count(*)::int as n from usage_events u join clients p on u.brand_id = p.id where u.org_id <> p.org_id` },
  ];
  for (const { label, query } of parentChecks) {
    const n = await scalar(query);
    if (n > 0) problems.push(`${label}: ${n} mismatch(es)`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Seed verification FAILED — tenant integrity violated:\n  - ${problems.join("\n  - ")}`
    );
  }
  console.log("Verification passed: 0 org_id nulls, 0 parent/child mismatches.\n");
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

// ── CLI entrypoint (only when run directly, not when imported by a test) ──

function printSummary(s: SeedSummary): void {
  console.log("=== Seed complete (two-org demo) ===");
  console.log(`Organizations:   ${s.orgs}`);
  console.log(`Brands:          ${s.brands}`);
  console.log(`Users:           ${s.users}`);
  console.log(`Memberships:     ${s.memberships}`);
  console.log(`Campaigns:       ${s.campaigns}`);
  console.log(`Candidates:      ${s.candidates}`);
  console.log(`Scoring Logs:    ${s.scoringLogs}`);
  console.log(`Messages:        ${s.messages}`);
  console.log(`Conversations:   ${s.conversations}`);
  console.log(`Chat Messages:   ${s.chatMessages}`);
  console.log(`Events:          ${s.events}`);
  console.log(`Jobs:            ${s.jobs}`);
  console.log(`Usage Events:    ${s.usageEvents}`);
  for (const [kind, n] of Object.entries(s.usageByKind)) {
    console.log(`  · ${kind}: ${n}`);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });
  try {
    const summary = await seed(db);
    printSummary(summary);
  } finally {
    await client.end();
  }
}

// Run only when executed directly (`tsx src/db/seed.ts`) — importing this module
// (e.g. from the seed-verify test) must NOT auto-run the destructive rebuild.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
