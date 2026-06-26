import type { Metadata } from "next";
import { LegalPage, type TocItem } from "@/components/legal/legal-page";
import { COMPANY, REGULATOR, LEGAL_UPDATED } from "@/components/legal/company";

export const metadata: Metadata = {
  title: "Privacy Policy — TalentStream",
  description:
    "How TalentStream collects, uses, shares and protects personal information, in line with the Protection of Personal Information Act (POPIA) and South African law.",
};

const TOC: TocItem[] = [
  { id: "who-we-are", label: "1. Who we are and our two roles" },
  { id: "what-we-collect", label: "2. The personal information we collect" },
  { id: "sources", label: "3. Where we get your information" },
  { id: "why", label: "4. Why we use it and our lawful basis" },
  { id: "ai", label: "5. AI-assisted screening and automated decisions" },
  { id: "special", label: "6. Special personal information" },
  { id: "sharing", label: "7. Who we share it with" },
  { id: "cross-border", label: "8. Storage and cross-border transfers" },
  { id: "security", label: "9. How we keep it secure" },
  { id: "retention", label: "10. How long we keep it" },
  { id: "rights", label: "11. Your rights" },
  { id: "marketing", label: "12. Direct marketing" },
  { id: "cookies", label: "13. Cookies and similar technologies" },
  { id: "children", label: "14. Children's information" },
  { id: "changes", label: "15. Changes to this policy" },
  { id: "contact", label: "16. How to contact us" },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={
        <>
          <p>
            {COMPANY.legalName} (&ldquo;{COMPANY.shortName}&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo; or &ldquo;our&rdquo;) provides an AI-assisted
            recruitment platform that helps employers run hiring campaigns and
            manage candidate applications. We take the protection of your personal
            information seriously and process it in accordance with the{" "}
            <strong>
              Protection of Personal Information Act 4 of 2013 (POPIA)
            </strong>{" "}
            and other applicable South African law.
          </p>
          <p>
            This policy explains what personal information we collect, why we use
            it, who we share it with, how we keep it safe and the rights you have.
            Please read it together with our{" "}
            <a href="/popia">POPIA Notice</a> and{" "}
            <a href="/terms">Terms &amp; Conditions</a>.
          </p>
        </>
      }
    >
      <section id="who-we-are">
        <h2>1. Who we are and our two roles</h2>
        <p>
          Under POPIA, the party that decides why and how personal information is
          processed is the <strong>responsible party</strong>, and a party that
          processes personal information on behalf of a responsible party is an{" "}
          <strong>operator</strong>. {COMPANY.shortName} acts in both roles
          depending on whose information is involved:
        </p>
        <ul>
          <li>
            <strong>We are the responsible party</strong> for the personal
            information of our own account holders and operator users (the people
            at employer organisations who log in to use the platform), our website
            visitors, our prospects and our own staff. This policy is our notice to
            those people.
          </li>
          <li>
            <strong>We are an operator</strong> for the candidate and applicant
            information that our employer customers upload or collect through their
            hiring campaigns. In that case the employer is the responsible party
            and decides how that information is used. We process it only on the
            employer&rsquo;s documented instructions, under a written operator
            agreement as required by section 21 of POPIA. If you applied for a role
            through a campaign and want to exercise your rights, you may contact us
            and we will route your request to the relevant employer, or assist them
            in responding.
          </li>
        </ul>
        <p>
          Our identity and contact details, including the information required by
          section 43 of the Electronic Communications and Transactions Act 25 of
          2002, appear in section 16 below and in our{" "}
          <a href="/terms">Terms &amp; Conditions</a>.
        </p>
      </section>

      <section id="what-we-collect">
        <h2>2. The personal information we collect</h2>
        <p>
          We collect only the information we need for the purposes set out in this
          policy. The categories below depend on how you interact with us.
        </p>
        <h3>Account and operator users</h3>
        <ul>
          <li>
            Identity and contact details — name, work email address, telephone
            number, job title and the employer organisation you belong to.
          </li>
          <li>
            Account and security data — login credentials (passwords are stored in
            hashed form), authentication tokens, roles and permissions.
          </li>
          <li>
            Billing and transaction data — billing contact, the plan you are on,
            usage and credit consumption, invoices and payment records. We do not
            store full card numbers; card payments, where offered, are handled by a
            payment processor.
          </li>
        </ul>
        <h3>Candidates and applicants</h3>
        <ul>
          <li>
            Application data — name, contact details, CV or résumé, cover letter,
            work history, education, skills, and the answers you give to screening
            questions.
          </li>
          <li>
            Assessment data — ratings, scores, notes, shortlist status and other
            information generated as your application is reviewed (including by our
            AI features, described in section 5).
          </li>
          <li>
            Communications — messages exchanged through the platform, including
            email and, where enabled, chat or messaging channels.
          </li>
        </ul>
        <h3>Everyone — technical and usage data</h3>
        <ul>
          <li>
            Device and connection data — IP address, browser and device type,
            and similar technical identifiers.
          </li>
          <li>
            Usage data — pages viewed, features used, and actions taken, collected
            to operate, secure and improve the service.
          </li>
        </ul>
      </section>

      <section id="sources">
        <h2>3. Where we get your information</h2>
        <ul>
          <li>
            <strong>Directly from you</strong> — when you register, complete an
            application form, contact us, or use the platform.
          </li>
          <li>
            <strong>From our employer customers</strong> — when, as a responsible
            party, they upload or share candidate information with the platform.
          </li>
          <li>
            <strong>Automatically</strong> — technical and usage data collected
            through cookies and similar technologies when you use our website and
            platform (see section 13).
          </li>
        </ul>
        <p>
          Where POPIA requires it, we collect personal information directly from
          you. Where we obtain it from another source, we take reasonably
          practicable steps to make you aware of that source.
        </p>
      </section>

      <section id="why">
        <h2>4. Why we use it and our lawful basis</h2>
        <p>
          We process personal information for specific, explicitly defined and
          lawful purposes, namely to:
        </p>
        <ul>
          <li>create and administer accounts and provide the platform;</li>
          <li>
            run recruitment campaigns and manage applications, screening,
            shortlisting and communication with candidates on behalf of employers;
          </li>
          <li>
            calculate usage, bill for the service and collect payment;
          </li>
          <li>
            provide support, respond to enquiries and send service and
            transactional messages (such as application updates, invoices and
            security notices);
          </li>
          <li>
            secure the platform, prevent fraud and misuse, and keep audit records;
          </li>
          <li>
            improve and develop our service, including through analytics on
            de-identified or aggregated data; and
          </li>
          <li>comply with our legal and regulatory obligations.</li>
        </ul>
        <p>
          We rely on one or more of the lawful grounds for processing recognised in
          section 11 of POPIA, which include: your consent; that processing is
          necessary to conclude or perform a contract with you; that it is required
          by law; that it protects a legitimate interest; or that it is necessary
          for our (or a third party&rsquo;s) legitimate interests, balanced against
          your rights. Where we rely on consent, you may withdraw it at any time,
          although this will not affect processing carried out before withdrawal.
        </p>
      </section>

      <section id="ai">
        <h2>5. AI-assisted screening and automated decisions</h2>
        <p>
          Our platform uses artificial intelligence to help employers screen, rate
          and rank applications more efficiently — for example by summarising a CV,
          matching it against a role specification or suggesting a score.
        </p>
        <p>
          Section 71 of POPIA gives you the right not to be subject to a decision
          that has legal or similarly significant consequences for you and that is
          based <strong>solely</strong> on automated processing intended to profile
          you. We design the platform so that AI output is{" "}
          <strong>decision-support, not the decision itself</strong>: our customers
          are required, under our{" "}
          <a href="/terms">Terms &amp; Conditions</a>, to keep a human in the loop
          and to make hiring decisions through meaningful human review. The
          responsible employer remains accountable for its hiring decisions and for
          its obligations under the Employment Equity Act 55 of 1998 and other law.
        </p>
        <p>
          You may ask the employer responsible for a campaign about the logic
          involved in any AI-assisted assessment of your application and may make
          representations about a decision. We will assist the employer in
          responding to such requests.
        </p>
      </section>

      <section id="special">
        <h2>6. Special personal information</h2>
        <p>
          Some recruitment processes involve &ldquo;special personal
          information&rdquo; as defined in section 26 of POPIA — for example
          information about race or ethnic origin (often collected for employment
          equity reporting), health or disability, or criminal history (where a
          background check is required for a role). Processing of special personal
          information is prohibited unless an exception in section 27 applies, such
          as your consent, that it is necessary to exercise or perform a right or
          obligation in law, or another listed ground.
        </p>
        <p>
          Where the platform processes this kind of information, it does so on
          behalf of, and on the instructions of, the responsible employer, who is
          responsible for establishing a lawful basis. We apply additional care and
          access controls to this information. Please do not submit special
          personal information unless it is requested.
        </p>
      </section>

      <section id="sharing">
        <h2>7. Who we share it with</h2>
        <p>
          We do not sell your personal information. We share it only as needed to
          run the service:
        </p>
        <ul>
          <li>
            <strong>Employer customers</strong> — candidate information is shared
            with the employer running the relevant campaign, who is the responsible
            party for that information.
          </li>
          <li>
            <strong>Our operators (sub-processors)</strong> — trusted service
            providers who process personal information on our behalf under written
            contracts that require POPIA-compliant security, including our cloud
            hosting provider, email delivery provider and, where enabled, messaging
            or chat providers. They may act only on our instructions.
          </li>
          <li>
            <strong>Professional advisers and authorities</strong> — where required
            by law, to protect our rights, or to comply with a lawful request.
          </li>
          <li>
            <strong>Business transfers</strong> — to a successor in the event of a
            merger, acquisition or sale of assets, subject to this policy.
          </li>
        </ul>
      </section>

      <section id="cross-border">
        <h2>8. Storage and cross-border transfers</h2>
        <p>
          We host the platform and store customer and candidate data in the{" "}
          {COMPANY.hostingRegion}. We aim to keep personal information in South
          Africa.
        </p>
        <p>
          Some of our operators may process limited personal information outside the
          Republic (for example, certain email-delivery or support tooling). Where
          personal information is transferred across the South African border, we do
          so in accordance with section 72 of POPIA — that is, only where the
          recipient is subject to a law, binding corporate rules or a binding
          agreement that provides an adequate level of protection comparable to
          POPIA; where you have consented; where the transfer is necessary to
          perform a contract with you; or on another ground permitted by section 72.
        </p>
      </section>

      <section id="security">
        <h2>9. How we keep it secure</h2>
        <p>
          In line with section 19 of POPIA, we maintain appropriate, reasonable
          technical and organisational measures to protect personal information
          against loss, damage, unauthorised destruction and unlawful access or
          processing. These include encryption in transit, access controls and
          role-based permissions, tenant isolation between customers, audit logging
          and regular review of our safeguards. No system can be guaranteed
          completely secure, but we work to keep our measures current with generally
          accepted information-security practice.
        </p>
        <p>
          If we have reasonable grounds to believe that personal information has
          been accessed or acquired by an unauthorised person, we will, as required
          by section 22 of POPIA, notify the Information Regulator and the affected
          data subjects (or, where we act as operator, the responsible employer) as
          soon as reasonably possible after becoming aware of it.
        </p>
      </section>

      <section id="retention">
        <h2>10. How long we keep it</h2>
        <p>
          We keep personal information only for as long as necessary to fulfil the
          purposes described in this policy, unless a longer period is required or
          permitted by law, by contract, or with your consent (section 14 of
          POPIA). Retention periods depend on the type of information — for example,
          billing records are kept for the periods required by tax and company law,
          while candidate data is retained for the period instructed by the
          responsible employer.
        </p>
        <p>
          When personal information is no longer needed, we delete, destroy or
          de-identify it in a manner that prevents its reconstruction. We may retain
          aggregated or de-identified data, which is no longer personal information,
          for analytics and to improve our service.
        </p>
      </section>

      <section id="rights">
        <h2>11. Your rights</h2>
        <p>Subject to POPIA, you have the right to:</p>
        <ul>
          <li>be notified that we are collecting your personal information;</li>
          <li>
            request access to the personal information we hold about you and to be
            told the identity of third parties who have, or have had, access to it
            (section 23);
          </li>
          <li>
            request that we correct or delete personal information that is
            inaccurate, irrelevant, excessive, out of date, incomplete, misleading
            or obtained unlawfully (section 24);
          </li>
          <li>
            object, on reasonable grounds, to the processing of your personal
            information;
          </li>
          <li>object to processing for direct marketing purposes;</li>
          <li>
            not be subject to a decision based solely on automated processing
            (section 71, and see section 5 above);
          </li>
          <li>
            submit a complaint to the Information Regulator (section 74); and
          </li>
          <li>institute civil proceedings regarding an alleged breach.</li>
        </ul>
        <p>
          To exercise any of these rights, contact us using the details in section
          16. We may need to verify your identity before acting on a request.
          Certain requests may be made on the forms prescribed under POPIA, and we
          will let you know if that applies.
        </p>
      </section>

      <section id="marketing">
        <h2>12. Direct marketing</h2>
        <p>
          We will only send you electronic direct marketing (such as marketing
          emails) where the law allows — that is, where you have consented or where
          you are an existing customer and we are marketing our own similar products
          or services. Every marketing message will identify us and offer a free,
          easy way to opt out, and we will stop on request.
        </p>
        <p>
          Transactional and service messages — such as application status updates,
          invoices, security alerts and account notices — are not direct marketing
          and are sent as part of providing the service.
        </p>
      </section>

      <section id="cookies">
        <h2>13. Cookies and similar technologies</h2>
        <p>
          We use cookies and similar technologies to operate the website and
          platform, keep you signed in, remember your preferences, keep the service
          secure and understand how it is used. Strictly necessary cookies are
          required for the platform to function. Where cookies are not strictly
          necessary and identify you, we will ask for your consent and you can
          withdraw it at any time through your browser settings or any cookie
          controls we provide. Blocking some cookies may affect how the site works.
        </p>
      </section>

      <section id="children">
        <h2>14. Children&rsquo;s information</h2>
        <p>
          Our service is intended for use by employers and adult job seekers. We do
          not knowingly collect the personal information of children (persons under
          18) except where permitted by section 35 of POPIA, such as with the prior
          consent of a competent person. If you believe we have collected a
          child&rsquo;s information without a lawful basis, please contact us and we
          will take appropriate steps.
        </p>
      </section>

      <section id="changes">
        <h2>15. Changes to this policy</h2>
        <p>
          We may update this policy from time to time to reflect changes in our
          service, technology or the law. We will post the updated version here and
          change the &ldquo;last updated&rdquo; date above. Where changes are
          material, we will take reasonable steps to bring them to your attention.
        </p>
      </section>

      <section id="contact">
        <h2>16. How to contact us</h2>
        <p>
          If you have any questions about this policy, or wish to exercise your
          rights, please contact our Information Officer:
        </p>
        <ul>
          <li>
            <strong>{COMPANY.legalName}</strong>
          </li>
          <li>Information Officer: {COMPANY.informationOfficer}</li>
          <li>
            Email:{" "}
            <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>
          </li>
          <li>Registered office: {COMPANY.registeredAddress}</li>
        </ul>
        <p>
          You also have the right to lodge a complaint with the supervisory
          authority:
        </p>
        <ul>
          <li>
            <strong>{REGULATOR.name}</strong>
          </li>
          <li>{REGULATOR.physical}</li>
          <li>
            Complaints:{" "}
            <a href={`mailto:${REGULATOR.popiaComplaintsEmail}`}>
              {REGULATOR.popiaComplaintsEmail}
            </a>
          </li>
          <li>
            General enquiries:{" "}
            <a href={`mailto:${REGULATOR.generalEmail}`}>
              {REGULATOR.generalEmail}
            </a>
          </li>
          <li>Telephone: {REGULATOR.tel}</li>
          <li>
            Website:{" "}
            <a href={REGULATOR.website} target="_blank" rel="noreferrer">
              {REGULATOR.website}
            </a>
          </li>
        </ul>
      </section>
    </LegalPage>
  );
}
