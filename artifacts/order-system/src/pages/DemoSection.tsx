import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  Warehouse, Boxes, ListChecks, ShoppingBag, Send, FileText, Truck, CheckSquare,
  ArrowRight, Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DemoLayout from "./DemoLayout";
import { getDemoToken } from "@/lib/demo";

const SECTIONS: Record<string, {
  title: string;
  description: string;
  icon: React.ElementType;
  colour: string;
  features: string[];
}> = {
  stock: {
    title: "Stock",
    description: "Track live stock levels across all your products. See what's in the warehouse, what's allocated to orders, and what needs reordering.",
    icon: Warehouse,
    colour: "bg-blue-100 text-blue-600",
    features: [
      "Live stock levels per product variant",
      "Allocated vs. available stock view",
      "Low-stock alerts and reorder triggers",
      "Stock movement history and audit log",
    ],
  },
  "process-stock": {
    title: "Process Stock",
    description: "The garment decoration workflow. Assign stock to decoration jobs, track embroidery, printing, and heat-transfer processes through to completion.",
    icon: Boxes,
    colour: "bg-violet-100 text-violet-600",
    features: [
      "Assign garments to decoration jobs",
      "Track embroidery, print, and heat-transfer progress",
      "Mark jobs complete and release to dispatch",
      "Process photos and quality checks",
    ],
  },
  production: {
    title: "Production",
    description: "See every active order through the production pipeline from order confirmation to decoration complete, with real-time status per job.",
    icon: ListChecks,
    colour: "bg-amber-100 text-amber-600",
    features: [
      "Production board with order status at a glance",
      "Group orders by decoration supplier",
      "Bulk status updates across multiple orders",
      "Required-by date tracking and alerts",
    ],
  },
  purchasing: {
    title: "Purchasing",
    description: "Raise and track purchase orders to your garment suppliers. Link POs to sales orders and monitor expected delivery dates.",
    icon: ShoppingBag,
    colour: "bg-emerald-100 text-emerald-600",
    features: [
      "Create purchase orders from sales orders",
      "Track PO status and expected delivery",
      "Multi-supplier management",
      "PO PDF generation and email to supplier",
    ],
  },
  dispatch: {
    title: "Dispatch",
    description: "Generate DPD shipping labels directly from the system. Mark orders as dispatched with tracking numbers that customers can see in the portal.",
    icon: Send,
    colour: "bg-sky-100 text-sky-600",
    features: [
      "DPD label generation built-in",
      "Batch dispatch multiple orders at once",
      "Tracking numbers pushed to customer portal",
      "Delivery confirmation and proof of dispatch",
    ],
  },
  invoicing: {
    title: "Invoicing",
    description: "Generate and send customer invoices directly from completed orders. Export to Xero, track payment status, and manage credit notes.",
    icon: FileText,
    colour: "bg-indigo-100 text-indigo-600",
    features: [
      "One-click invoice generation from orders",
      "PDF invoice with your branding",
      "Email directly to customer from the system",
      "Xero integration for accounting sync",
    ],
  },
  suppliers: {
    title: "Suppliers",
    description: "Manage your garment and decoration suppliers, track their product ranges, lead times, and purchase history.",
    icon: Truck,
    colour: "bg-orange-100 text-orange-600",
    features: [
      "Supplier contact and product range management",
      "Lead time and pricing tracking",
      "Purchase order history per supplier",
      "Preferred supplier settings per product",
    ],
  },
  tasks: {
    title: "Tasks",
    description: "Internal task management for your team — create follow-up tasks linked to orders or customers, assign to team members, and track completion.",
    icon: CheckSquare,
    colour: "bg-rose-100 text-rose-600",
    features: [
      "Create tasks linked to orders or customers",
      "Assign to team members",
      "Due date tracking and overdue alerts",
      "Task completion history",
    ],
  },
};

export default function DemoSection({ section }: { section: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  const info = SECTIONS[section];
  if (!info) return null;

  const Icon = info.icon;

  return (
    <DemoLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${info.colour}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{info.title}</h1>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{info.description}</p>
          </div>
        </div>

        {/* Feature preview */}
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Available in your live account</p>
            </div>
            <ul className="space-y-2.5">
              {info.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-7 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-white font-semibold text-base mb-1">Want to see {info.title} in action?</p>
            <p className="text-slate-400 text-sm">Our team will walk you through a live tailored demo.</p>
          </div>
          <a href="mailto:" className="shrink-0">
            <Button variant="secondary" className="gap-2 font-semibold">
              Book a call <ArrowRight className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </div>
    </DemoLayout>
  );
}
