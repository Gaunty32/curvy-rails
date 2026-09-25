import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, ShoppingCart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch } from "@/lib/demo";

export default function DemoCustomers() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["demo-customers"],
    queryFn: () => demoFetch("/demo/customers"),
  });

  const customers: any[] = data?.customers ?? [];

  return (
    <DemoLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {customers.length > 0 ? `${customers.length.toLocaleString()} customers — names anonymised in demo` : "Loading customer list…"}
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">#</TableHead>
                    <TableHead>Company name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right pr-5">Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No customers found</TableCell>
                    </TableRow>
                  ) : (
                    customers.map((c: any, i: number) => (
                      <TableRow key={c.id} className="hover:bg-muted/40">
                        <TableCell className="pl-5 text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <Users className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-muted-foreground/70 select-none">{c.name_masked}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.city ?? "—"}</TableCell>
                        <TableCell className="text-right pr-5">
                          <div className="flex items-center justify-end gap-1.5">
                            <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium">{parseInt(c.order_count ?? "0").toLocaleString()}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DemoLayout>
  );
}
