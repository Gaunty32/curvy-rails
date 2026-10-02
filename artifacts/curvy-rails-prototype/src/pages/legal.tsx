import { PageShell } from '@/components/page-shell';

const P = ({ children }: { children: string }) => <p className="mb-4 max-w-2xl leading-relaxed">{children}</p>;
const H = ({ children }: { children: string }) => <h2 className="font-display mb-2 mt-8 text-2xl uppercase">{children}</h2>;
const note = 'Draft demonstration text only, not legal advice. To be replaced with approved wording before launch.';

export function DeliveryReturns() {
  return (
    <PageShell title="Delivery & Returns" description="Curvy Rails demo delivery and returns information: free UK delivery over £50, otherwise £3.99." heading="Delivery & returns">
      <P children={note} />
      <H children="Delivery" />
      <P children="UK delivery is free on orders of £50 or more. Orders under £50 are charged £3.99. No orders are actually fulfilled in this prototype." />
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
      <P children="Basket, signups, contact messages and catalogue edits are saved in your own browser's local storage. They are not sent to a server, and there are no accounts, analytics or cookies for tracking. Clearing your browser data removes them." />
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
