/**
 * Single source of truth for the legal/identity facts that the Privacy, POPIA and
 * Terms pages all cite, so they can never drift apart.
 *
 * ── BEFORE PUBLISHING ─────────────────────────────────────────────────────────
 * Items in square brackets are placeholders that must be completed (and the whole
 * set signed off by an admitted South African attorney) before these pages go
 * live. ECTA s43(1) specifically requires the registration number, the registered
 * office bearers' details, and a physical address for service of legal documents
 * (domicilium citandi et executandi) to appear on the site, so those cannot ship
 * as placeholders.
 */
export const COMPANY = {
  legalName: "TalentStream (Pty) Ltd",
  shortName: "TalentStream",
  /** Companies and Intellectual Property Commission (CIPC) registration number. */
  regNo: "[CIPC registration number — e.g. 20XX/XXXXXX/07]",
  /** Only required if the company is a registered VAT vendor. */
  vatNo: "[VAT registration number, if registered]",
  /** Registered / principal physical address. */
  registeredAddress: "[Registered office — street address, city, postal code]",
  /** Physical address for service of legal process (ECTA s43(1)(g)). */
  domicilium: "[Physical address for service of legal documents]",
  /** Office bearers / directors (ECTA s43(1)(f)). */
  officeBearers: "[Names of the directors / office bearers]",
  placeOfRegistration: "Republic of South Africa",
  generalEmail: "hello@talentstream.co.za",
  /** Channel for privacy / data-protection enquiries and data-subject requests. */
  privacyEmail: "hello@talentstream.co.za",
  /** The Information Officer is, by default, the head of the company (POPIA reads
   *  "head" from PAIA). Name the appointed/registered individual here. */
  informationOfficer: "[Information Officer name and title]",
  informationOfficerEmail: "hello@talentstream.co.za",
  /** Where customer and candidate data physically lives. */
  hostingRegion: "Microsoft Azure, South Africa North (Johannesburg) region",
} as const;

/**
 * Information Regulator (South Africa) — the supervisory authority for POPIA and
 * PAIA. Contact details verified against the Regulator's site (the office moved to
 * Woodmead in 2025; older Braamfontein street listings are stale). Re-verify the
 * postal address and the current breach-notification submission route on the
 * eServices portal before relying on them.
 */
export const REGULATOR = {
  name: "Information Regulator (South Africa)",
  physical:
    "JD House, Woodmead North Office Park, 54 Maxwell Drive, Woodmead, Johannesburg, 2191",
  generalEmail: "enquiries@inforegulator.org.za",
  popiaComplaintsEmail: "POPIAComplaints@inforegulator.org.za",
  paiaComplaintsEmail: "PAIAComplaints@inforegulator.org.za",
  tel: "010 023 5200",
  website: "https://inforegulator.org.za",
} as const;

/** Effective / last-updated date shown on every legal page. Update on each revision. */
export const LEGAL_UPDATED = "26 June 2026";
