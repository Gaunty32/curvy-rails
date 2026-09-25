import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectableProductCategory {
  id: number;
  wooId: number | null;
  name: string;
  parentWooId?: number | null;
}

interface ProductCategoryMultiSelectProps {
  categories: SelectableProductCategory[];
  selectedWooIds: number[];
  onChange: (wooIds: number[]) => void;
}

export function ProductCategoryMultiSelect({
  categories,
  selectedWooIds,
  onChange,
}: ProductCategoryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedWooIds), [selectedWooIds]);
  const options = useMemo(
    () => categories
      .filter((category) => category.wooId != null)
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })),
    [categories],
  );
  const selectedCategories = options.filter((category) => selectedSet.has(Number(category.wooId)));

  const toggle = (wooId: number) => {
    onChange(
      selectedSet.has(wooId)
        ? selectedWooIds.filter((id) => id !== wooId)
        : [...selectedWooIds, wooId],
    );
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", selectedCategories.length === 0 && "text-muted-foreground")}>
              {selectedCategories.length === 0
                ? "Select one or more categories…"
                : `${selectedCategories.length} ${selectedCategories.length === 1 ? "category" : "categories"} selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories…" />
            <CommandList className="max-h-72">
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                {options.map((category) => {
                  const wooId = Number(category.wooId);
                  const selected = selectedSet.has(wooId);
                  return (
                    <CommandItem
                      key={category.id}
                      value={`${category.name} ${wooId}`}
                      onSelect={() => toggle(wooId)}
                    >
                      <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{category.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCategories.map((category) => (
            <span
              key={category.id}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800"
            >
              {category.name}
              <button
                type="button"
                onClick={() => toggle(Number(category.wooId))}
                className="rounded-full p-0.5 hover:bg-blue-100"
                aria-label={`Remove ${category.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}