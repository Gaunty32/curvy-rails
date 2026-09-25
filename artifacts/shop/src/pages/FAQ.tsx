import { useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const FAQ_TABS = [
  { id: 'ordering', label: "ORDERING FAQ'S" },
  { id: 'sizing', label: "SIZING FAQ'S" },
  { id: 'logo', label: "LOGO & BRANDING FAQ'S" },
  { id: 'care', label: "GARMENT CARE FAQ'S" }
];

const FAQS_BY_TAB: Record<string, { q: string; a: string }[]> = {
  ordering: [
    { q: 'What is the lead time on orders?', a: 'We aim to deliver orders within 7-10 days of all logos being approved. Plain garments are usually dispatched within 2-3 working days.' },
    { q: 'Where do you deliver to?', a: 'Standard delivery is £8.50 for a next day UK service. We also ship across Europe; please contact us for international rates.' },
    { q: 'Are your products bleach resistant?', a: 'There are several fabrics that are not affected by bleach, please contact our team to discuss specific requirements.' },
    { q: 'How do I send my order requirements?', a: 'You can order online, send us an email, call our team, or use your dedicated corporate portal if set up.' },
    { q: 'Is there a minimum order quantity?', a: 'There is no minimum order quantity. You can order exactly what you need, when you need it.' },
    { q: 'How long will this uniform last?', a: 'This depends on the garment, usage, and care. Our products are sourced from leading brands known for their durability.' }
  ],
  sizing: [
    { q: 'How do I know what size to order?', a: 'Each garment has a sizing guide available on the product page. If you need further assistance, please contact us.' },
    { q: 'Can you come and measure my staff?', a: 'Yes, we offer on-site measuring services for larger teams. Contact us to arrange a visit.' }
  ],
  logo: [
    { q: 'What format do you need my logo in?', a: 'We prefer high-resolution JPEG, PNG, or vector formats like EPS or PDF.' },
    { q: 'Is logo setup free?', a: 'Yes, we offer free logo digitization and standard left breast application on all garments.' }
  ],
  care: [
    { q: 'How should I wash branded garments?', a: 'Always follow the wash care label inside the garment. We generally recommend washing inside out at 30 or 40 degrees.' },
    { q: 'Can I tumble dry embroidered clothing?', a: 'We recommend avoiding tumble drying to prolong the life of the embroidery and print.' }
  ]
};

const RECENT_POSTS = [
  { title: 'The Importance of Branded Workwear', date: 'Oct 15, 2023' },
  { title: 'How to Choose the Right Polo Shirt', date: 'Sep 22, 2023' },
  { title: 'Winter Workwear Essentials', date: 'Aug 05, 2023' }
];

export default function FAQ() {
  useSEO({
    title: 'Frequently Asked Questions',
    description: 'Answers to the most common questions about ordering workwear and uniforms from the configured business — sizing, delivery, logo application, lead times and more.',
  });
  const [activeTab, setActiveTab] = useState('ordering');

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-extrabold text-primary mb-12 text-center uppercase">Frequently Asked Questions</h1>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Main Content */}
        <div className="flex-1">
          {/* Tabs */}
          <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-200">
            {FAQ_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 px-6 font-bold text-sm transition-colors border-b-2 -mb-[2px] ${
                  activeTab === tab.id 
                    ? 'border-primary text-primary' 
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Accordion */}
          <Accordion type="multiple" className="w-full">
            {FAQS_BY_TAB[activeTab].map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border border-gray-200 mb-4 bg-white">
                <AccordionTrigger className="px-6 hover:no-underline hover:text-accent font-bold text-left">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-6 text-gray-600 leading-relaxed">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[300px] shrink-0">
          <div className="border border-gray-200 p-6 bg-gray-50">
            <h3 className="font-bold text-lg text-primary border-b-2 border-primary pb-2 inline-block mb-6 uppercase">Recent Posts</h3>
            <div className="space-y-6">
              {RECENT_POSTS.map((post, i) => (
                <div key={i} className="group cursor-pointer">
                  <h4 className="font-bold text-gray-800 text-sm group-hover:text-accent transition-colors mb-1">{post.title}</h4>
                  <p className="text-xs text-gray-500">{post.date}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
