import type { Metadata } from "next";
import { LegalPage, type TocItem } from "@/components/legal/legal-page";
import { COMPANY, REGULATOR, LEGAL_UPDATED } from "@/components/legal/company";

export const metadata: Metadata = {
  title: "POPIA Notice — TalentStream",
  description:
    "TalentStream's commitment to the Protection of Personal Information Act (POPIA): the eight conditions for lawful processing, your rights, our Information Officer and how to complain to the Information Regulator.",
};

const TOC: TocItem[] = [
  { id: "commitment", label: "1. Our commitment to POPIA" },
  { id: "roles", label: "2. Responsible party and operator" },
  { id: "conditions", label: "3. The eight conditions we apply" },
  { id: "collection", label: "4. What we tell you at collection" },
  { id: "rights", label: "5. Your rights and how to use them" },
  { id: "automated", label: "6. AI and automated decision-making" },
  { id: "operators", label: "7. Operators and sub-processors" },
  { id: "cross-border", label: "8. Cross-border transfers" },
  { id: "security", label: "9. Security and breach notification" },
  { id: "officer", label: "10. Information Officer and PAIA" },
  { id: "complaints", label: "11. Complaints to the Regulator" },
];

export default function PopiaNoticePage() {
  return (
    <LegalPage
      current="/popia"
      eyebrow="Compliance"
      title="POPIA Notice"
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={
        <>
          <p>
            This notice describes how {COMPANY.legalName} (&ldquo;
            {COMPANY.shortName}&rdquo;) complies with the{" "}
            <strong>Protection of Personal Information Act 4 of 2013</strong>{" "}
            (&ldquo;POPIA&rdquo;) and how you can exercise your rights as a data
            subject. It complements, and should be read with, our detailed{" "}
            <a href="/privacy">Privacy Policy</a>, which sets out exactly what
            information we collect and why.
          </p>
        </>
      }
    >
      <section id="commitment">
        <h2>1. Our commitment to POPIA</h2>
        <p>
          POPIA gives effect to the constitutional right to privacy by regulating
          how personal information is processed. We are committed to processing
          personal information lawfully, transparently and securely, and to
          upholding the rights that POPIA gives to data subjects. This notice
          explains, in plain terms, how we meet our obligations.
        </p>
      </section>

      <section id="roles">
        <h2>2. Responsible party and operator</h2>
        <p>
          POPIA distinguishes between the <strong>responsible party</strong> (who
          decides why and how personal information is processed) and the{" "}
          <strong>operator</strong> (who processes it on the responsible
          party&rsquo;s behalf, under that party&rsquo;s authority). Our role
          depends on whose information is involved:
        </p>
        <ul>
          <li>
            For our own account holders, operator users, website visitors and
            staff, <strong>we are the responsible party</strong>.
          </li>
          <li>
            For candidate and applicant information that employers process through
            their hiring campaigns, <strong>we are an operator</strong> acting for
            the employer, who is the responsible party. We process that information
            only on the employer&rsquo;s documented instructions and under a written
            operator agreement, as required by section 21 of POPIA.
          </li>
        </ul>
      </section>

      <section id="conditions">
        <h2>3. The eight conditions we apply</h2>
        <p>
          POPIA sets out eight conditions for the lawful processing of personal
          information. We have built our processes around them:
        </p>
        <ol>
          <li>
            <strong>Accountability</strong> — we take responsibility for complying
            with these conditions and can demonstrate how we do so.
          </li>
          <li>
            <strong>Processing limitation</strong> — we process personal information
            lawfully, in a reasonable manner that does not infringe your privacy,
            and we limit it to what is adequate, relevant and not excessive. Where
            POPIA requires it, we collect directly from you and rely on a recognised
            lawful ground.
          </li>
          <li>
            <strong>Purpose specification</strong> — we collect information for
            specific, explicitly defined and lawful purposes, and tell you what they
            are.
          </li>
          <li>
            <strong>Further processing limitation</strong> — we use information only
            in ways compatible with the purpose for which it was collected.
          </li>
          <li>
            <strong>Information quality</strong> — we take reasonable steps to keep
            information complete, accurate, up to date and not misleading.
          </li>
          <li>
            <strong>Openness</strong> — we maintain the required documentation and
            notify you when we collect your information, as this notice and our
            Privacy Policy do.
          </li>
          <li>
            <strong>Security safeguards</strong> — we secure the integrity and
            confidentiality of personal information with appropriate technical and
            organisational measures.
          </li>
          <li>
            <strong>Data subject participation</strong> — we give you access to
            your information and the ability to correct or delete it.
          </li>
        </ol>
      </section>

      <section id="collection">
        <h2>4. What we tell you at collection</h2>
        <p>
          When we collect personal information, section 18 of POPIA requires us to
          make you aware of certain things. We do this through our{" "}
          <a href="/privacy">Privacy Policy</a> and the notices shown when you
          register or apply. In summary, we tell you: what information is collected
          and, where it is not collected from you, its source; who we are and how to
          contact us; the purpose of collection; whether providing the information
          is voluntary or mandatory and the consequences of not providing it; any
          law that requires the collection; whether we intend to transfer the
          information to another country and the level of protection there; and
          your rights, including the right to access, correct and object, and to
          complain to the Information Regulator.
        </p>
      </section>

      <section id="rights">
        <h2>5. Your rights and how to use them</h2>
        <p>As a data subject under POPIA you have the right to:</p>
        <ul>
          <li>be notified when your personal information is collected;</li>
          <li>request access to the personal information we hold about you;</li>
          <li>request correction or deletion of your personal information;</li>
          <li>object, on reasonable grounds, to processing;</li>
          <li>object to processing for direct marketing;</li>
          <li>
            not be subject to a decision based solely on automated processing
            (see section 6);
          </li>
          <li>complain to the Information Regulator; and</li>
          <li>institute civil proceedings regarding a breach of your rights.</li>
        </ul>
        <p>
          To make a request, email our Information Officer at{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>. We
          may ask you to verify your identity and, where applicable, to use the
          relevant form prescribed under the POPIA Regulations. If your request
          relates to candidate information held on behalf of an employer, we will
          route it to that employer or assist them in responding, since they are the
          responsible party for that information.
        </p>
      </section>

      <section id="automated">
        <h2>6. AI and automated decision-making</h2>
        <p>
          Our platform uses AI to help employers screen and rate applications.
          Section 71 of POPIA protects you from decisions with legal or similarly
          significant effects that are based <strong>solely</strong> on automated
          processing intended to profile you. We treat AI output as
          decision-support only and require employers, under our{" "}
          <a href="/terms">Terms &amp; Conditions</a>, to apply meaningful human
          review before making hiring decisions. You may request information about
          the logic involved and make representations about a decision.
        </p>
      </section>

      <section id="operators">
        <h2>7. Operators and sub-processors</h2>
        <p>
          Where we use other service providers to process personal information on
          our behalf (for example cloud hosting, email delivery and messaging), we
          appoint them as operators under written contracts that require them to
          process the information only on our instructions, to keep it confidential
          and to maintain the security measures required by section 19 of POPIA.
          They must notify us immediately if they have reason to believe personal
          information has been accessed by an unauthorised person.
        </p>
        <p>
          Employer customers who use the platform enter into an operator (data
          processing) agreement with us, reflecting our role as their operator. A
          copy is available to customers on request.
        </p>
      </section>

      <section id="cross-border">
        <h2>8. Cross-border transfers</h2>
        <p>
          We host and store data in the {COMPANY.hostingRegion} and aim to keep
          personal information in South Africa. Where any transfer outside the
          Republic is necessary, we comply with section 72 of POPIA — transferring
          personal information only where the recipient is bound by adequate
          protection comparable to POPIA, where you have consented, where the
          transfer is necessary to perform a contract, or on another permitted
          ground.
        </p>
      </section>

      <section id="security">
        <h2>9. Security and breach notification</h2>
        <p>
          We secure personal information with appropriate, reasonable technical and
          organisational measures, as required by section 19 of POPIA, and we
          regularly review them. If we have reasonable grounds to believe that
          personal information has been accessed or acquired by an unauthorised
          person, section 22 of POPIA requires us to notify the Information
          Regulator and the affected data subjects as soon as reasonably possible.
          Where we act as an operator, we will notify the responsible employer so
          that they can meet their notification obligations.
        </p>
      </section>

      <section id="officer">
        <h2>10. Information Officer and PAIA</h2>
        <p>
          Our Information Officer is responsible for encouraging and monitoring
          compliance with POPIA, dealing with requests made to us, and working with
          the Information Regulator. Our Information Officer is{" "}
          {COMPANY.informationOfficer} and can be reached at{" "}
          <a href={`mailto:${COMPANY.informationOfficerEmail}`}>
            {COMPANY.informationOfficerEmail}
          </a>
          .
        </p>
        <p>
          We also maintain a manual under the Promotion of Access to Information Act
          2 of 2000 (PAIA), which describes the records we hold and how to request
          access to them. Our PAIA manual is available on request from our
          Information Officer.
        </p>
      </section>

      <section id="complaints">
        <h2>11. Complaints to the Regulator</h2>
        <p>
          We would like the chance to resolve any concern first, so please contact
          our Information Officer. You also have the right to complain directly to
          the supervisory authority at any time:
        </p>
        <ul>
          <li>
            <strong>{REGULATOR.name}</strong>
          </li>
          <li>{REGULATOR.physical}</li>
          <li>
            POPIA complaints:{" "}
            <a href={`mailto:${REGULATOR.popiaComplaintsEmail}`}>
              {REGULATOR.popiaComplaintsEmail}
            </a>
          </li>
          <li>
            PAIA complaints:{" "}
            <a href={`mailto:${REGULATOR.paiaComplaintsEmail}`}>
              {REGULATOR.paiaComplaintsEmail}
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
