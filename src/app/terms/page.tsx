import type { Metadata } from "next";
import { LegalPage, type TocItem } from "@/components/legal/legal-page";
import { COMPANY, LEGAL_UPDATED } from "@/components/legal/company";

export const metadata: Metadata = {
  title: "Terms & Conditions — TalentStream",
  description:
    "The terms that govern your use of the TalentStream recruitment platform, including acceptable use, AI features, fees, liability and South African governing law.",
};

const TOC: TocItem[] = [
  { id: "definitions", label: "1. Definitions" },
  { id: "acceptance", label: "2. These terms and acceptance" },
  { id: "accounts", label: "3. Accounts and authorised users" },
  { id: "service", label: "4. The service and licence" },
  { id: "acceptable-use", label: "5. Acceptable use" },
  { id: "ai", label: "6. AI features and human oversight" },
  { id: "data", label: "7. Customer data and data protection" },
  { id: "fees", label: "8. Fees, usage-based billing and payment" },
  { id: "ip", label: "9. Intellectual property" },
  { id: "confidentiality", label: "10. Confidentiality" },
  { id: "availability", label: "11. Availability and support" },
  { id: "warranties", label: "12. Warranties and disclaimers" },
  { id: "liability", label: "13. Limitation of liability" },
  { id: "indemnity", label: "14. Indemnities" },
  { id: "term", label: "15. Term, suspension and termination" },
  { id: "force-majeure", label: "16. Force majeure" },
  { id: "changes", label: "17. Changes to the service and terms" },
  { id: "notices", label: "18. Notices" },
  { id: "cpa", label: "19. Consumer Protection Act" },
  { id: "law", label: "20. Governing law and disputes" },
  { id: "general", label: "21. General" },
  { id: "company", label: "22. Company details" },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms & Conditions"
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={
        <>
          <p>
            These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your access to
            and use of the {COMPANY.shortName} recruitment platform and related
            services (the &ldquo;Service&rdquo;) provided by {COMPANY.legalName}{" "}
            (&ldquo;{COMPANY.shortName}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
            By creating an account or using the Service, you agree to these Terms. If
            you are entering into them on behalf of an organisation, you confirm that
            you are authorised to bind that organisation.
          </p>
          <p>
            Please read these Terms carefully. They include important provisions
            that <strong>limit our liability</strong> and require you to{" "}
            <strong>indemnify us</strong> in certain circumstances. Those provisions
            are highlighted below.
          </p>
        </>
      }
    >
      <section id="definitions">
        <h2>1. Definitions</h2>
        <ul>
          <li>
            <strong>Customer</strong> — the organisation (or individual) that
            subscribes to the Service.
          </li>
          <li>
            <strong>Authorised User</strong> — an individual the Customer permits to
            access the Service under the Customer&rsquo;s account.
          </li>
          <li>
            <strong>Candidate</strong> — a person who applies for, or is considered
            for, a role through the Service.
          </li>
          <li>
            <strong>Customer Data</strong> — data, including personal information,
            that the Customer or its Authorised Users or Candidates submit to, or
            that is generated through, the Service.
          </li>
          <li>
            <strong>POPIA</strong> — the Protection of Personal Information Act 4 of
            2013; <strong>responsible party</strong> and <strong>operator</strong>{" "}
            have the meanings given in POPIA.
          </li>
          <li>
            <strong>Fees</strong> — the charges payable for the Service, including
            any usage-based charges.
          </li>
        </ul>
      </section>

      <section id="acceptance">
        <h2>2. These terms and acceptance</h2>
        <p>
          These Terms, together with any order form, plan description, our{" "}
          <a href="/privacy">Privacy Policy</a>, our{" "}
          <a href="/popia">POPIA Notice</a>, any acceptable use policy and any
          operator (data processing) agreement, form the agreement between you and
          us (the &ldquo;Agreement&rdquo;). If there is a conflict, a signed order
          form prevails over these Terms, and the operator agreement prevails on
          matters of personal-information processing. Acceptance may be given
          electronically, and you agree that electronic acceptance is valid and
          binding under the Electronic Communications and Transactions Act 25 of
          2002 (&ldquo;ECTA&rdquo;).
        </p>
      </section>

      <section id="accounts">
        <h2>3. Accounts and authorised users</h2>
        <p>
          You must provide accurate registration information and keep it up to date.
          You are responsible for your account, for all activity under it, and for
          keeping login credentials confidential. You must notify us promptly of any
          unauthorised use. You are responsible for your Authorised Users&rsquo;
          compliance with these Terms. We secure the platform infrastructure; you
          are responsible for securing access at your end.
        </p>
      </section>

      <section id="service">
        <h2>4. The service and licence</h2>
        <p>
          Subject to these Terms and payment of the Fees, we grant the Customer a
          non-exclusive, non-transferable, non-sublicensable right to access and use
          the Service during the term, for its internal recruitment purposes. We may
          improve, change or add to the Service from time to time. All rights not
          expressly granted are reserved.
        </p>
      </section>

      <section id="acceptable-use">
        <h2>5. Acceptable use</h2>
        <p>You agree not to, and not to permit any person to:</p>
        <ul>
          <li>use the Service unlawfully or for any unlawful purpose;</li>
          <li>
            upload Customer Data you are not entitled to process, or that infringes
            the rights of others;
          </li>
          <li>
            use the Service to discriminate unfairly against any person contrary to
            the Constitution, the Employment Equity Act 55 of 1998 or other law;
          </li>
          <li>
            copy, modify, reverse-engineer, decompile or create derivative works of
            the Service, except as the law expressly permits;
          </li>
          <li>
            resell, rent or make the Service available to third parties outside your
            organisation, or use it to build a competing product;
          </li>
          <li>
            introduce malicious code, attempt to gain unauthorised access, or
            interfere with the integrity or performance of the Service; or
          </li>
          <li>
            scrape or harvest data, or place unreasonable load on the Service.
          </li>
        </ul>
      </section>

      <section id="ai">
        <h2>6. AI features and human oversight</h2>
        <p>
          The Service uses artificial intelligence to assist with screening, rating
          and ranking applications. AI output is provided as{" "}
          <strong>decision-support only</strong> and may contain errors or
          inaccuracies. It is not a substitute for the Customer&rsquo;s own
          judgement.
        </p>
        <div className="callout">
          <p>
            <strong>The Customer must keep a human in the loop.</strong> The Customer
            is responsible for reviewing AI output and for all recruitment and hiring
            decisions, and must not rely solely on automated processing to make a
            decision that has legal or similarly significant effects on a Candidate
            (as contemplated by section 71 of POPIA). The Customer remains the
            responsible party and remains accountable for compliance with the
            Employment Equity Act, POPIA and other applicable law, including the
            avoidance of unfair discrimination. The use of AI does not transfer or
            reduce that responsibility.
          </p>
        </div>
        <p>
          We take reasonable steps to develop our AI features responsibly, but we do
          not warrant that AI output is accurate, complete, unbiased or fit for any
          particular hiring decision.
        </p>
      </section>

      <section id="data">
        <h2>7. Customer data and data protection</h2>
        <p>
          As between the parties, the Customer owns its Customer Data. The Customer
          grants us the right to process Customer Data to provide and support the
          Service. In processing personal information contained in Customer Data, the
          Customer is the responsible party and we act as its operator under section
          21 of POPIA. Our processing is governed by our operator (data processing)
          agreement and our <a href="/privacy">Privacy Policy</a> and{" "}
          <a href="/popia">POPIA Notice</a>.
        </p>
        <p>
          The Customer warrants that it has a lawful basis to provide Customer Data
          to us and to instruct the processing we carry out, including any special
          personal information and any cross-border instructions. We may use
          aggregated and de-identified data, which does not identify any person, to
          operate, secure and improve the Service.
        </p>
      </section>

      <section id="fees">
        <h2>8. Fees, usage-based billing and payment</h2>
        <p>
          The Customer agrees to pay the Fees for the plan it selects. The Service is
          billed on a usage basis, which may include consumption of AI credits or
          other metered usage as described at sign-up or on the applicable order
          form. Usage is measured by our systems, and those measurements are used to
          calculate the Fees.
        </p>
        <ul>
          <li>
            Unless stated otherwise, Fees are exclusive of Value-Added Tax (VAT),
            which is added where applicable.
          </li>
          <li>
            Invoices are payable by the due date stated on them. Overdue amounts may
            attract interest at the rate prescribed under the Prescribed Rate of
            Interest Act 55 of 1975.
          </li>
          <li>
            We may suspend the Service for non-payment after giving you reasonable
            notice and an opportunity to remedy.
          </li>
          <li>
            We may change Fees on reasonable prior notice; changes take effect at the
            start of the next billing period.
          </li>
        </ul>
      </section>

      <section id="ip">
        <h2>9. Intellectual property</h2>
        <p>
          We (and our licensors) own all intellectual property rights in the Service,
          including its software, models, designs and documentation. These Terms do
          not transfer any of those rights to you. You own your Customer Data. Any
          feedback you give us about the Service may be used by us without
          restriction or obligation to you.
        </p>
      </section>

      <section id="confidentiality">
        <h2>10. Confidentiality</h2>
        <p>
          Each party may receive confidential information of the other. Each party
          will keep the other&rsquo;s confidential information confidential, use it
          only to perform the Agreement, and protect it with reasonable care. This
          does not apply to information that is public through no fault of the
          recipient, independently developed, or required to be disclosed by law (in
          which case the recipient will, where lawful, give notice).
        </p>
      </section>

      <section id="availability">
        <h2>11. Availability and support</h2>
        <p>
          We aim to make the Service available reliably and to provide reasonable
          support, but unless a separate service-level agreement says otherwise, the
          Service is provided without a guaranteed level of uptime. We may carry out
          maintenance, and will use reasonable efforts to limit disruption and to
          give notice of planned downtime where practicable.
        </p>
      </section>

      <section id="warranties">
        <h2>12. Warranties and disclaimers</h2>
        <p>
          We warrant that we will provide the Service with reasonable skill and care.
          Except as expressly stated in these Terms, and to the maximum extent
          permitted by law:
        </p>
        <div className="callout">
          <p>
            <strong>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo;, and we disclaim all other warranties, whether
              express or implied, including any implied warranties of
              merchantability, fitness for a particular purpose and non-infringement.
            </strong>{" "}
            We do not warrant that the Service will be uninterrupted or error-free,
            that it will meet your requirements, or that AI output will be accurate
            or suitable for any decision. Nothing in these Terms limits any rights
            you have that cannot lawfully be excluded, including under the Consumer
            Protection Act 68 of 2008 where it applies (see section 19).
          </p>
        </div>
      </section>

      <section id="liability">
        <h2>13. Limitation of liability</h2>
        <div className="callout">
          <p>
            <strong>
              To the maximum extent permitted by law, neither party is liable to the
              other for any indirect, incidental, special or consequential loss, or
              for loss of profits, revenue, goodwill, anticipated savings or data,
              however it arises.
            </strong>
          </p>
          <p>
            <strong>
              Our total aggregate liability arising out of or in connection with the
              Agreement is limited to the Fees paid or payable by the Customer for
              the Service in the twelve (12) months before the event giving rise to
              the claim.
            </strong>
          </p>
          <p>
            These limitations do not apply to liability that cannot be limited or
            excluded by law, including liability for death or personal injury caused
            by negligence, for fraud or fraudulent misrepresentation, or for gross
            negligence or wilful misconduct. The limitations and exclusions apply to
            the fullest extent permitted, and the Customer acknowledges that they are
            reasonable given the nature of the Service and the Fees.
          </p>
        </div>
      </section>

      <section id="indemnity">
        <h2>14. Indemnities</h2>
        <div className="callout">
          <p>
            <strong>
              The Customer indemnifies us against all claims, losses, damages and
              reasonable costs (including legal costs) arising from: (a) the Customer
              Data, including any claim that it infringes a third party&rsquo;s
              rights or was processed without a lawful basis; (b) the Customer&rsquo;s
              use of the Service in breach of these Terms or the law, including any
              unfair discrimination or breach of the Employment Equity Act in
              connection with a hiring decision; and (c) the Customer&rsquo;s breach
              of its data-protection obligations.
            </strong>
          </p>
        </div>
        <p>
          We will indemnify the Customer against third-party claims that the Service,
          as provided by us and used in accordance with these Terms, infringes that
          third party&rsquo;s intellectual property rights, provided the Customer
          notifies us promptly and lets us control the defence.
        </p>
      </section>

      <section id="term">
        <h2>15. Term, suspension and termination</h2>
        <p>
          The Agreement starts when you first accept these Terms or use the Service
          and continues for the subscription term, renewing as stated on the
          applicable plan or order form unless cancelled. Either party may terminate
          for material breach that is not remedied within a reasonable period (and at
          least 14 days) after written notice. We may suspend or limit the Service
          where necessary to protect the Service, comply with law, or address a
          serious breach.
        </p>
        <p>
          On termination, your right to use the Service ends. For a reasonable period
          after termination (and on request, where practicable), we will make
          Customer Data available for export. After that period we will delete or
          de-identify Customer Data in accordance with POPIA and our retention
          practices, unless we are required to retain it by law. Provisions that by
          their nature should survive termination will do so.
        </p>
      </section>

      <section id="force-majeure">
        <h2>16. Force majeure</h2>
        <p>
          Neither party is liable for failure or delay caused by events beyond its
          reasonable control, including natural disasters, war, civil unrest,
          epidemics, failure of telecommunications or internet infrastructure, and
          interruptions to electricity supply (including load-shedding or grid
          failure). The affected party will take reasonable steps to mitigate the
          impact.
        </p>
      </section>

      <section id="changes">
        <h2>17. Changes to the service and terms</h2>
        <p>
          We may update these Terms from time to time. We will post the updated Terms
          here and, where the changes are material, take reasonable steps to notify
          you. Your continued use of the Service after the changes take effect
          constitutes acceptance. If you do not accept a material change, your remedy
          is to stop using the Service and cancel in accordance with these Terms.
        </p>
      </section>

      <section id="notices">
        <h2>18. Notices</h2>
        <p>
          We may give you notices through the Service or by email to the address on
          your account, and you agree that such electronic notices are valid under
          ECTA. You may give us notice by email to{" "}
          <a href={`mailto:${COMPANY.generalEmail}`}>{COMPANY.generalEmail}</a>, with
          formal legal notices also sent to our address for service in section 22.
        </p>
      </section>

      <section id="cpa">
        <h2>19. Consumer Protection Act</h2>
        <p>
          The Service is intended for use by businesses. The Consumer Protection Act
          68 of 2008 (&ldquo;CPA&rdquo;) does not apply to transactions where the
          Customer is a juristic person whose asset value or annual turnover equals
          or exceeds the threshold determined by the Minister (currently R2 million).
          If the Customer is such a juristic person, it warrants that this is the
          case. Where the CPA does apply, nothing in these Terms is intended to limit
          or exclude any right that the CPA gives you and cannot lawfully be excluded,
          and these Terms must be read to give effect to those rights.
        </p>
      </section>

      <section id="law">
        <h2>20. Governing law and disputes</h2>
        <p>
          These Terms and the Agreement are governed by the laws of the Republic of
          South Africa. The parties will first try in good faith to resolve any
          dispute by negotiation between senior representatives. If the dispute is
          not resolved within a reasonable time, either party may refer it to
          arbitration under the rules of the Arbitration Foundation of Southern
          Africa (AFSA), seated in South Africa and conducted in English. Nothing in
          this section prevents a party from approaching a competent South African
          court for urgent or interim relief, and the parties submit to the
          jurisdiction of the High Court of South Africa for that purpose.
        </p>
      </section>

      <section id="general">
        <h2>21. General</h2>
        <ul>
          <li>
            <strong>Whole agreement</strong> — the Agreement is the entire agreement
            between the parties about the Service and supersedes prior discussions.
          </li>
          <li>
            <strong>Severability</strong> — if a provision is found invalid or
            unenforceable, the rest of the Terms remain in effect.
          </li>
          <li>
            <strong>No waiver</strong> — a failure to enforce a right is not a waiver
            of it.
          </li>
          <li>
            <strong>Assignment</strong> — you may not cede or assign your rights
            without our consent; we may assign to an affiliate or successor.
          </li>
          <li>
            <strong>Relationship</strong> — the parties are independent contractors;
            nothing creates a partnership, agency or employment relationship.
          </li>
        </ul>
      </section>

      <section id="company">
        <h2>22. Company details</h2>
        <p>
          The information below is provided in accordance with section 43 of ECTA:
        </p>
        <ul>
          <li>
            <strong>Full legal name</strong>: {COMPANY.legalName} (a private company
            registered in the {COMPANY.placeOfRegistration}).
          </li>
          <li>
            <strong>Registration number</strong>: {COMPANY.regNo}.
          </li>
          <li>
            <strong>VAT number</strong>: {COMPANY.vatNo}.
          </li>
          <li>
            <strong>Directors / office bearers</strong>: {COMPANY.officeBearers}.
          </li>
          <li>
            <strong>Registered office</strong>: {COMPANY.registeredAddress}.
          </li>
          <li>
            <strong>Address for service of legal documents</strong>:{" "}
            {COMPANY.domicilium}.
          </li>
          <li>
            <strong>Email</strong>:{" "}
            <a href={`mailto:${COMPANY.generalEmail}`}>{COMPANY.generalEmail}</a>.
          </li>
          <li>
            <strong>Website</strong>: this website.
          </li>
        </ul>
      </section>
    </LegalPage>
  );
}
