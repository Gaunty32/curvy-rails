export interface GuideStep {
  id: string;
  title: string;
  content: string;
  narrationText: string;
  highlightAction?: string;
}

export interface Guide {
  slug: string;
  title: string;
  description: string;
  audience: string;
  duration: string;
  updatedDate: string;
  steps: GuideStep[];
}

export const guides: Guide[] = [
  {
    slug: "stock-take",
    title: "How to Update Stock Quantities",
    description: "Find a garment, record the counted stock, assign its storage box and print a box label.",
    audience: "Production Staff",
    duration: "4 mins",
    updatedDate: "2026-09-04",
    steps: [
      { id: "step-1", title: "Find the Item", content: "Open Stock and select Plain Stock or Finish Stock. Search using a product, variant or supplier code.", narrationText: "First, open Stock and select the Plain Stock tab. Search using the product or variant code, or the supplier code printed on the garment packaging.", highlightAction: "search" },
      { id: "step-2", title: "Check Colour and Size", content: "Check the product name, colour, size and supplier code before changing anything. Never combine different colours or sizes into one count.", narrationText: "Check the product name, colour, size, and supplier code before changing anything. Never combine different colours or sizes into one count.", highlightAction: "variant-row" },
      { id: "step-3", title: "Open Stock Take", content: "Click Stock Take on the correct product row. Use the colour and size filters if the product has many variants.", narrationText: "Click Stock Take on the correct product row. If the product has many variants, use the colour and size filters to narrow the list.", highlightAction: "stock-take-btn" },
      { id: "step-4", title: "Enter Counted Total", content: "Enter the physical total you counted in Qty. This replaces the current figure: enter the new total, not the amount you are adding or removing.", narrationText: "Enter the physical total you counted in Quantity. This replaces the current figure, so enter the new total, not the amount you are adding or removing.", highlightAction: "qty-input" },
      { id: "step-5", title: "Assign the Numbered Box", content: "Enter an existing box number in Bin, or type the new box number you are using. Then save the changes.", narrationText: "Enter an existing box number in the Bin field, or type the new box number you are using. Then save the changes.", highlightAction: "bin-input" },
      { id: "step-6", title: "Create and Label a New Box", content: "For a new box, open Bin View and choose New Bin. Enter the box number, create it, then print its box-number label.", narrationText: "For a new box, open Bin View and choose New Bin. Enter the box number and create it. Then use the label button on that box to print its box number label.", highlightAction: "print-label" },
      { id: "step-7", title: "Verify Before Moving On", content: "Return to Plain Stock and check that the correct colour and size now show the counted total and box number.", narrationText: "Return to Plain Stock and check that the correct colour and size now show the counted total and box number. Only then move to the next item.", highlightAction: "verify" },
    ],
  },
];