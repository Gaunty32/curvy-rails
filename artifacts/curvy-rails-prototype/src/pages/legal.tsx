import { PageShell } from '@/components/page-shell';

const P = ({ children }: { children: string }) => <p className="mb-4 max-w-2xl leading-relaxed">{children}</p>;
const H = ({ children }: { children: string }) => <h2 className="font-display mb-2 mt-8 text-2xl uppercase">{children}</h2>;
const note = 'Draft demonstration text only, not legal advice. To be replaced with approved wording before launch.';

export function DeliveryReturns() {
  return (
    <PageShell title="Delivery & Returns" description="UK mainland delivery £3.99 including VAT, free over £50. Outside-mainland shipping confirmed separately." heading="Delivery & returns">
      <P children={note} />
      <H children="Delivery" />
      <P children="We dispatch all orders within 7 working days, excluding weekends. This is a dispatch timeframe, not a guaranteed arrival date." />
      <P children="All product prices and delivery charges include VAT. UK mainland delivery is £3.99, with free delivery when the product subtotal is over £50. An order with a product subtotal of exactly £50 has a £3.99 delivery charge." />
      <P children="We also accept orders for destinations outside the UK mainland. Shipping charges are confirmed separately and are additional to the displayed products total. The mainland free-delivery offer does not apply to these destinations, regardless of order value." />
      <P children="No real orders, shipping quotes or deliveries are processed in this demonstration. A shipping platform will be connected before fulfilment goes live." />
      <H children="Returns" />
      <P children="Placeholder policy: unworn items with tags can be returned within 30 days. Final terms to be confirmed with the real fulfilment set-up." />
    </PageShell>
  );
}
export function Privacy() {
  return (
    <PageShell title="Privacy Policy" description="Privacy information for the Curvy Rails demo prototype: data is saved in your browser only." heading="Privacy policy">
      <P children={note} />
      <H children="This prototype" />
      <P children="Basket, signup preview entries, contact messages and catalogue edits are saved in your own browser's local storage. Signup entries can include the required email address and phone number, optional first and last names and date of birth, plus separate email and SMS marketing choices. These details are not sent to a server; no email or SMS is sent, and no customer account or live subscription is created. Avoid entering real personal information in this demonstration. Clearing your browser data removes locally saved entries." />
      <P children="The email and SMS choices on the signup preview are optional and unchecked by default. They are recorded only in this browser for demonstration and do not subscribe you to marketing." />
      <H children="Production site" />
      <P children="A full policy covering payments, fulfilment, CRM, accounts and analytics will be written before launch." />
    </PageShell>
  );
}
export function Terms() {
  return (
    <PageShell title="Terms & Conditions" description="Terms for using the Curvy Rails demonstration prototype. No real sales take place." heading="Terms & conditions">
      <P children={note} />
      <P children="This is a demonstration website. Products, prices, images and checkout are placeholders. No contracts of sale are formed and no payments are taken." />
    </PageShell>
  );
}
