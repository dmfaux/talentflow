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
  // Box-Muller approximation
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

// ── Source data ──────────────────────────────────────────────────────

const CLIENTS = [
  {
    slug: "nedbank-digital", name: "Nedbank Digital",
    contact_name: "Thandi Mkhize", contact_email: "thandi.mkhize@nedbank.co.za",
    contact_phone: "+27 11 294 4444", billing_email: "accounts.digital@nedbank.co.za",
    notes: "Expanding digital banking team. Key partner for Q1-Q2 hiring.",
  },
  {
    slug: "discovery-health", name: "Discovery Health",
    contact_name: "Michael van der Merwe", contact_email: "michael.vdm@discovery.co.za",
    contact_phone: "+27 11 529 2888", billing_email: "hr.invoicing@discovery.co.za",
    notes: "Focus on data science and actuarial roles.",
  },
  {
    slug: "takealot-commerce", name: "Takealot Commerce",
    contact_name: "Sizwe Dlamini", contact_email: "sizwe.d@takealot.com",
    contact_phone: "+27 21 809 5900", billing_email: "finance@takealot.com",
    notes: "Rapid scaling across engineering and product teams.",
  },
  {
    slug: "anglo-american", name: "Anglo American",
    contact_name: "Priya Naidoo", contact_email: "priya.naidoo@angloamerican.com",
    contact_phone: "+27 11 638 9111", billing_email: "talent.ops@angloamerican.com",
    notes: "Technology modernisation programme. Platform and cloud roles.",
  },
  {
    slug: "woolworths-holdings", name: "Woolworths Holdings",
    contact_name: "Lerato Mokoena", contact_email: "lerato.mokoena@woolworths.co.za",
    contact_phone: "+27 21 407 9111", billing_email: "recruitment.finance@woolworths.co.za",
    notes: "Retail technology transformation.",
  },
  {
    slug: "mtn-group", name: "MTN Group",
    contact_name: "Johan Pretorius", contact_email: "johan.pretorius@mtn.com",
    contact_phone: "+27 11 912 3000", billing_email: "vendor.payments@mtn.com",
    notes: "Fintech and 5G platform initiatives.",
  },
  {
    slug: "standard-bank-tech", name: "Standard Bank Tech",
    contact_name: "Ayesha Patel", contact_email: "ayesha.patel@standardbank.co.za",
    contact_phone: "+27 11 721 5000", billing_email: "ap.tech@standardbank.co.za",
    notes: "Core banking platform rewrite. Multiple senior roles.",
  },
  {
    slug: "adcorp-group", name: "Adcorp Group",
    contact_name: "Ayesha Patel", contact_email: "ayesha.patel@adcorpgroup.com",
    contact_phone: "+27 11 721 5000", billing_email: "ap.tech@adcorp-group.com",
    notes: "Core banking platform rewrite. Multiple senior roles.",
  },
] as const;

const ROLES = [
  { title: "Senior Backend Engineer", department: "Engineering", employment_type: "Permanent", salary_min: 850000, salary_max: 1200000 },
  { title: "Staff Data Scientist", department: "Data", employment_type: "Permanent", salary_min: 950000, salary_max: 1400000 },
  { title: "Product Manager", department: "Product", employment_type: "Permanent", salary_min: 800000, salary_max: 1100000 },
  { title: "DevOps Engineer", department: "Platform", employment_type: "Permanent", salary_min: 700000, salary_max: 1000000 },
  { title: "Senior Frontend Developer", department: "Engineering", employment_type: "Permanent", salary_min: 750000, salary_max: 1100000 },
  { title: "QA Automation Engineer", department: "Quality", employment_type: "Permanent", salary_min: 550000, salary_max: 800000 },
  { title: "Mobile Developer (iOS)", department: "Engineering", employment_type: "Permanent", salary_min: 750000, salary_max: 1050000 },
  { title: "Platform Architect", department: "Engineering", employment_type: "Permanent", salary_min: 1200000, salary_max: 1800000 },
  { title: "Machine Learning Engineer", department: "Data", employment_type: "Permanent", salary_min: 900000, salary_max: 1350000 },
  { title: "Security Engineer", department: "Security", employment_type: "Permanent", salary_min: 800000, salary_max: 1200000 },
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

const FLAG_TEMPLATES = [
  "Two recent roles with tenure under 12 months — clarify reasons for departures",
  "CV gap between 2021 and 2022 not explained",
  "Job titles inconsistent with stated experience level",
  "Limited evidence of the specific technology stack mentioned in must-haves",
  "Self-assessed skill levels differ significantly from work history",
];

// ── Main seed function ───────────────────────────────────────────────

async function main() {
  console.log("Seeding database...");

  // Clear existing data in dependency order
  console.log("Clearing existing data...");
  await db.delete(schema.scoringLogs);
  await db.delete(schema.messages);
  await db.delete(schema.candidates);
  await db.delete(schema.campaigns);
  await db.delete(schema.clients);

  // Insert clients
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
    }))
  ).returning({ id: schema.clients.id, slug: schema.clients.slug, name: schema.clients.name });

  // Generate campaigns — 2-4 per client
  console.log("Generating campaigns...");
  const campaignsToInsert: typeof schema.campaigns.$inferInsert[] = [];
  const campaignIndex: { client_id: string; client_slug: string; slug: string; role_title: string; status: string }[] = [];

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
        role_description: `We are seeking a ${role.title} to join our ${role.department.toLowerCase()} team. The role involves delivering high-quality solutions and collaborating with cross-functional teams.`,
        department: role.department,
        location: pick(LOCATIONS),
        employment_type: role.employment_type,
        status,
        html_template: status !== "draft" ? `<html><body><h1>${role.title} at ${c.name}</h1><p>Apply now.</p></body></html>` : null,
        gating_config: buildGating(role.department),
        scoring_rubric: buildRubric(role.title),
        campaign_start: campaignStart,
        campaign_end: campaignEnd,
        salary_range_min: role.salary_min,
        salary_range_max: role.salary_max,
      });

      campaignIndex.push({ client_id: c.id, client_slug: c.slug, slug: baseSlug, role_title: role.title, status });
    }
  }

  const insertedCampaigns = await db.insert(schema.campaigns).values(campaignsToInsert).returning({
    id: schema.campaigns.id,
    slug: schema.campaigns.slug,
    client_id: schema.campaigns.client_id,
    status: schema.campaigns.status,
    gating_config: schema.campaigns.gating_config,
  });

  console.log(`Inserted ${insertedCampaigns.length} campaigns.`);

  // Generate candidates — only for active/paused/closed campaigns
  console.log("Generating candidates...");
  const candidatesToInsert: typeof schema.candidates.$inferInsert[] = [];

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

      if (!gatingPassed) {
        status = "gating_failed";
      } else {
        const scoreBucket = weighted([
          { value: "scored", weight: 55 },
          { value: "follow_up", weight: 15 },
          { value: "shortlisted", weight: 15 },
          { value: "rejected", weight: 10 },
          { value: "gating_passed", weight: 5 }, // awaiting scoring
        ]);
        status = scoreBucket;

        if (status !== "gating_passed") {
          const mean = status === "shortlisted" ? 8.7 : status === "rejected" ? 4.5 : status === "follow_up" ? 6.8 : 6.5;
          aiScore = Math.round(normalScore(mean, 1.0) * 10) / 10;
          aiConfidence = aiScore >= 8.0 ? pick(["high", "high", "medium"]) : aiScore >= 6.0 ? pick(["high", "medium", "medium"]) : pick(["medium", "low", "low"]);
          aiRationale = aiScore >= 8.0 ? pick(RATIONALES_STRONG) : aiScore >= 6.5 ? pick(RATIONALES_GOOD) : pick(RATIONALES_WEAK);
          aiDimensions = {
            skills_match: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            experience_depth: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            career_progression: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
            tenure_patterns: Math.round(normalScore(aiScore, 0.8) * 10) / 10,
          };
          aiFlags = status === "follow_up"
            ? [pick(FLAG_TEMPLATES), ...(rand() < 0.4 ? [pick(FLAG_TEMPLATES)] : [])]
            : rand() < 0.2 ? [pick(FLAG_TEMPLATES)] : [];
        }
      }

      const appliedDaysAgo = randInt(1, 30);
      const now = daysAgo(appliedDaysAgo);
      const purgeAt = new Date(now);
      purgeAt.setMonth(purgeAt.getMonth() + 12);

      candidatesToInsert.push({
        campaign_id: campaign.id,
        name,
        email,
        phone,
        whatsapp_opted_in: rand() < 0.6,
        gating_answers: answers,
        gating_passed: gatingPassed,
        cv_url: status !== "gating_failed" && rand() < 0.7 ? `https://example.blob.core.windows.net/cvs/placeholder/${email}.pdf` : null,
        cv_text: status !== "gating_failed" && rand() < 0.7 ? `Professional with experience in the required areas. Work history includes multiple relevant positions.` : null,
        ai_score: aiScore,
        ai_dimensions: aiDimensions,
        ai_rationale: aiRationale,
        ai_confidence: aiConfidence,
        ai_flags: aiFlags,
        status,
        shortlist_notes: status === "shortlisted" ? "Strong candidate — schedule technical interview" : null,
        follow_up_notes: status === "follow_up" ? "Pending clarification on CV gaps. WhatsApp sent." : null,
        source: pick(SOURCES),
        popia_consent_at: now,
        data_purge_at: purgeAt,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Insert candidates in batches
  console.log(`Inserting ${candidatesToInsert.length} candidates...`);
  const BATCH_SIZE = 500;
  const insertedCandidates: { id: string; campaign_id: string; status: string; email: string; name: string; ai_score: number | null; ai_rationale: string | null }[] = [];
  for (let i = 0; i < candidatesToInsert.length; i += BATCH_SIZE) {
    const batch = candidatesToInsert.slice(i, i + BATCH_SIZE);
    const result = await db.insert(schema.candidates).values(batch).returning({
      id: schema.candidates.id,
      campaign_id: schema.candidates.campaign_id,
      status: schema.candidates.status,
      email: schema.candidates.email,
      name: schema.candidates.name,
      ai_score: schema.candidates.ai_score,
      ai_rationale: schema.candidates.ai_rationale,
    });
    insertedCandidates.push(...result);
  }

  // Generate scoring logs for scored candidates
  console.log("Generating scoring logs...");
  const scoringLogsToInsert: typeof schema.scoringLogs.$inferInsert[] = [];
  for (const cand of insertedCandidates) {
    if (cand.ai_score !== null) {
      scoringLogsToInsert.push({
        candidate_id: cand.id,
        model_version: "claude-sonnet-4-20250514",
        full_prompt: `You are an expert recruitment assessor...\n\n## Role\n[role details]\n\n## CV\n[cv text redacted]\n\n## Instructions\nScore 1-10 on each dimension.`,
        full_response: JSON.stringify({
          overall_score: cand.ai_score,
          confidence: "medium",
          rationale: cand.ai_rationale,
          flags: [],
          recommendation: cand.ai_score >= 8.5 ? "strong_recommend" : cand.ai_score >= 7.5 ? "recommend" : cand.ai_score >= 6 ? "recommend_with_caveats" : cand.ai_score >= 5 ? "borderline" : "reject",
        }, null, 2),
        score: cand.ai_score,
        processing_time_ms: randInt(2800, 8500),
      });
    }
  }
  for (let i = 0; i < scoringLogsToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.scoringLogs).values(scoringLogsToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${scoringLogsToInsert.length} scoring logs.`);

  // Generate messages
  console.log("Generating messages...");
  const messagesToInsert: typeof schema.messages.$inferInsert[] = [];
  for (const cand of insertedCandidates) {
    // Application received email
    messagesToInsert.push({
      candidate_id: cand.id,
      channel: "email",
      direction: "outbound",
      content: "Application received — thank you for applying.",
      status: "delivered",
      external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
    });
    // Gating result email
    if (cand.status === "gating_failed") {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "Application update — unfortunately we are unable to progress your application at this time.",
        status: "delivered",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    } else {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "email",
        direction: "outbound",
        content: "Good news — your CV is being reviewed by our team.",
        status: "delivered",
        external_id: `resend_${Math.random().toString(36).slice(2, 12)}`,
      });
    }
    // Follow-up messages for follow_up status
    if (cand.status === "follow_up" && rand() < 0.7) {
      messagesToInsert.push({
        candidate_id: cand.id,
        channel: "whatsapp",
        direction: "outbound",
        content: "Template: application_followup",
        template_id: "application_followup",
        status: "delivered",
        external_id: `wati_${Math.random().toString(36).slice(2, 12)}`,
      });
      if (rand() < 0.5) {
        messagesToInsert.push({
          candidate_id: cand.id,
          channel: "whatsapp",
          direction: "inbound",
          content: "Thank you for reaching out. I was on sabbatical during 2021-2022, happy to discuss further.",
          status: "delivered",
          external_id: `wati_${Math.random().toString(36).slice(2, 12)}`,
        });
      }
    }
  }
  for (let i = 0; i < messagesToInsert.length; i += BATCH_SIZE) {
    await db.insert(schema.messages).values(messagesToInsert.slice(i, i + BATCH_SIZE));
  }
  console.log(`Inserted ${messagesToInsert.length} messages.`);

  // Summary
  const [counts] = await db.select({
    clients: sql<number>`(select count(*) from clients)::int`,
    campaigns: sql<number>`(select count(*) from campaigns)::int`,
    candidates: sql<number>`(select count(*) from candidates)::int`,
    scoring_logs: sql<number>`(select count(*) from scoring_logs)::int`,
    messages: sql<number>`(select count(*) from messages)::int`,
  }).from(sql`(select 1) t`);

  console.log("\n=== Seed complete ===");
  console.log(`Clients:       ${counts.clients}`);
  console.log(`Campaigns:     ${counts.campaigns}`);
  console.log(`Candidates:    ${counts.candidates}`);
  console.log(`Scoring Logs:  ${counts.scoring_logs}`);
  console.log(`Messages:      ${counts.messages}`);

  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
