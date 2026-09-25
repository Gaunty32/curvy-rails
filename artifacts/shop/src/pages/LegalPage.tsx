import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

type LegalDocument = 'terms' | 'privacy' | 'cookies';

type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

const DOCUMENTS: Record<LegalDocument, {
  title: string;
  description: string;
  intro: string;
  sections: LegalSection[];
}> = {
  terms: {
    title: 'Terms & Conditions',
    description: 'The terms that apply when you use the the configured business website or place an order with us.',
    intro: 'These terms explain how this website and our online ordering service work. By using the website, you agree to use it lawfully and in line with these terms.',
    sections: [
      {
        heading: 'About our service',
        paragraphs: [
          'the configured business supplies workwear, uniforms, embroidery, print and related branding services to organisations and individuals. Product descriptions, images and prices are provided to help you make an informed choice and may change as ranges and supplier availability change.',
        ],
      },
      {
        heading: 'Orders and availability',
        paragraphs: [
          'Submitting an online order or enquiry is a request for us to supply the items or services shown. An order is accepted when we confirm it. We may contact you if an item is unavailable, a price has changed, or we need more information before confirming the order.',
          'Personalised, embroidered, printed or otherwise bespoke work may require artwork approval before production. We will explain any relevant charges, lead times and approval steps before work begins.',
        ],
      },
      {
        heading: 'Prices, payment and delivery',
        paragraphs: [
          'Prices shown on the shop are displayed with the applicable VAT view selected by you. Delivery charges, lead times and any agreed branding or setup costs will be shown or confirmed before the order is finalised.',
          'We aim to meet the delivery estimate provided, but it can be affected by supplier availability, artwork approval, courier delays or events outside our reasonable control. If an important deadline applies, please tell us before ordering so we can advise.',
        ],
      },
      {
        heading: 'Cancellations, returns and faults',
        paragraphs: [
          'If you need to change or cancel an order, contact us as soon as possible. Bespoke or personalised items may not be cancellable once production has started, except where required by law.',
          'Nothing in these terms limits your statutory rights. If an item arrives damaged, incorrect or faulty, please contact us promptly with the order details and photographs where helpful so we can investigate and arrange the appropriate remedy.',
        ],
      },
      {
        heading: 'Website use and intellectual property',
        paragraphs: [
          'You must not misuse the website, attempt unauthorised access, introduce malicious code, or use our content for commercial purposes without permission. The website design, copy, logos and images belong to the configured business or their respective rights holders.',
        ],
      },
      {
        heading: 'Contact and governing law',
        paragraphs: [
          'Questions about an order or these terms can be sent to the configured business contact option or raised through our contact page. These terms are governed by the laws of England and Wales, and the courts of England and Wales will have jurisdiction, subject to any mandatory consumer rights that apply.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'How the configured business collects, uses and protects personal information submitted through the shop.',
    intro: 'We respect your privacy. This policy describes the personal information we may collect through this website, why we use it, and the choices available to you.',
    sections: [
      {
        heading: 'Information we collect',
        paragraphs: [
          'We may collect your name, business details, email address, telephone number, delivery and billing information, order details, logo artwork and messages when you make an enquiry, place an order, request a quote or use a customer portal.',
          'We also receive technical information needed to operate and secure the website, such as browser, device, approximate location, pages visited and error information.',
        ],
      },
      {
        heading: 'How we use information',
        bullets: [
          'To respond to enquiries, quotes and requests for product or branding advice.',
          'To process orders, payments, delivery, embroidery, print and artwork approvals.',
          'To provide customer portals, account support and order updates.',
          'To maintain, secure and improve the website and prevent misuse.',
          'To send service communications and, where permitted, relevant marketing. You can opt out of marketing at any time.',
        ],
      },
      {
        heading: 'Who we share it with',
        paragraphs: [
          'We share information only where needed to provide the service or meet a legal obligation. This can include payment providers, delivery companies, product and branding suppliers, technology providers, professional advisers and authorities where the law requires it. Suppliers and service providers receive only the information needed for their role.',
        ],
      },
      {
        heading: 'Retention and security',
        paragraphs: [
          'We keep information for as long as needed to provide the service, maintain business and tax records, resolve disputes and meet legal obligations. We use access controls and appropriate technical and organisational measures to protect information, but no online transmission or storage system can be guaranteed completely secure.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'Depending on the circumstances, you may have rights to access, correct, delete or restrict use of your personal information, object to certain processing, receive a copy of information you provided, and withdraw consent where processing relies on consent. To make a request, email the configured business contact option. You can also complain to the UK Information Commissioner’s Office.',
        ],
      },
      {
        heading: 'Contact us',
        paragraphs: [
          'For privacy questions or requests, email the configured business contact option or use our contact page. We may need to verify your identity before completing a request.',
        ],
      },
    ],
  },
  cookies: {
    title: 'Cookie Policy',
    description: 'How cookies and similar technologies are used on the the configured business website.',
    intro: 'Cookies are small text files stored on your device. This policy explains the types of cookies that may be used to keep the shop working and remember your preferences.',
    sections: [
      {
        heading: 'Necessary cookies',
        paragraphs: [
          'Some cookies and browser storage are necessary for core features such as security, session handling, shopping basket behaviour and remembering interface preferences. The website cannot provide those features reliably if they are disabled.',
        ],
      },
      {
        heading: 'Optional cookies',
        paragraphs: [
          'Anonymous first-party analytics is consent-gated. If you allow it, the shop stores a random visitor identifier in local storage and a session identifier, session-entry attribution and short-lived activity timestamp in session storage, and sends anonymous first-party events. These are not cookies and are not set until you allow analytics. If you decline, these identifiers are removed and no analytics events are sent. You can change your choice using the Analytics control on the site.',
        ],
      },
      {
        heading: 'Third-party services',
        paragraphs: [
          'Some services used to process payments, provide portals, deliver content or protect the website may set their own cookies or use similar technologies. Their own privacy and cookie notices explain how those technologies work.',
        ],
      },
      {
        heading: 'Managing cookies',
        paragraphs: [
          'You can block or delete cookies through your browser settings. Blocking necessary storage may affect the basket, sign-in and other shop functions. For questions about this policy, email the configured business contact option or use our contact page.',
        ],
      },
    ],
  },
};

export default function LegalPage({ document }: { document: LegalDocument }) {
  const content = DOCUMENTS[document];

  useSEO({
    title: content.title,
    description: content.description,
  });

  return (
    <article className="container mx-auto max-w-4xl px-4 py-10 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-900">{content.title}</span>
      </nav>

      <header className="mb-10 border-b border-gray-200 pb-8">
        <h1 className="text-3xl font-extrabold uppercase tracking-wide text-primary md:text-5xl">{content.title}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-gray-600">{content.intro}</p>
      </header>

      <div className="space-y-9 text-gray-700">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-3 text-xl font-bold text-gray-900 md:text-2xl">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mb-3 leading-relaxed last:mb-0">{paragraph}</p>
            ))}
            {section.bullets && (
              <ul className="list-disc space-y-2 pl-6 leading-relaxed">
                {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="mt-12 border border-primary/20 bg-primary/5 p-6">
        <h2 className="text-lg font-bold text-primary">Need help?</h2>
        <p className="mt-2 leading-relaxed text-gray-700">
          If you have a question about these policies or an order, <Link href="/contact" className="font-semibold text-primary underline underline-offset-2">contact our team</Link>.
        </p>
      </div>
    </article>
  );
}