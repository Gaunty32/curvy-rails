import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch } from "@/lib/demo";

function formatCurrency(v: string | number | null | undefined) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "—" : `£${n.toFixed(2)}`;
}

export default function DemoProducts() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["demo-products", debouncedSearch],
    queryFn: () => demoFetch(`/demo/products?search=${encodeURIComponent(debouncedSearch)}`),
  });

  const products: any[] = data?.products ?? [];
  const total: number = data?.total ?? 0;

  return (
    <DemoLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Products</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{total.toLocaleString()} products across all categories</p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 w-14">Image</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right pr-5">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        No products match your search
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((p: any) => (
                      <TableRow key={p.id} className="hover:bg-muted/40">
                        <TableCell className="pl-5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.product_name} className="w-9 h-9 object-contain rounded bg-white border" />
                          ) : (
                            <div className="w-9 h-9 rounded bg-muted flex items-center justify-center">
                              <Package className="w-4 h-4 text-muted-foreground/40" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium text-sm">{p.product_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{p.product_sku ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.category_name ?? p.category ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium text-right pr-5">{formatCurrency(p.unit_price ?? p.regular_price)}</TableCell>
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
