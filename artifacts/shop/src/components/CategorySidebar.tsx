import { useWcCategories } from '@/hooks/use-wc';
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { compareCategoryNames, formatCategoryName } from '@/lib/categoryName';

export function CategorySidebar({ activeSlug }: { activeSlug?: string }) {
  const { data: categories = [], isLoading } = useWcCategories();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);

  // Keep the active category's branch visible when arriving from a category tile
  // or a direct link. The hierarchy itself comes from WooCommerce via the API.
  useEffect(() => {
    if (!activeSlug || categories.length === 0) return;

    const activeCategory = categories.find((category: any) => category.slug === activeSlug);
    if (!activeCategory) return;

    const byId = new Map<number, any>(
      categories.map((category: any) => [Number(category.id), category]),
    );
    const idsToExpand: number[] = [];
    let current = activeCategory;

    while (current) {
      const currentId = Number(current.id);
      idsToExpand.push(currentId);
      const parentId = Number(current.parent ?? 0);
      current = parentId ? byId.get(parentId) : undefined;
    }

    setExpanded((previous) => {
      const next = { ...previous };
      idsToExpand.forEach((id) => { next[id] = true; });
      return next;
    });
  }, [activeSlug, categories]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-4 border-2 border-gray-100 rounded-md">
        <div className="h-6 bg-gray-200 w-2/3 rounded-sm" />
        <div className="space-y-3 mt-4">
          <div className="h-4 bg-gray-100 w-full rounded-sm" />
          <div className="h-4 bg-gray-100 w-5/6 rounded-sm" />
          <div className="h-4 bg-gray-100 w-4/5 rounded-sm" />
        </div>
      </div>
    );
  }

  // Build tree
  const map = new Map<number, any>();
  categories.forEach((c: any) => map.set(c.id, { ...c, children: [] }));
  const tree: any[] = [];
  categories.forEach((c: any) => {
    if (c.parent && map.has(c.parent)) {
      map.get(c.parent).children.push(map.get(c.id));
    } else {
      tree.push(map.get(c.id));
    }
  });
  const sortTree = (nodes: any[]) => {
    nodes.sort(compareCategoryNames);
    nodes.forEach(node => sortTree(node.children));
  };
  sortTree(tree);

  const renderNode = (node: any, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded[node.id];
    const isActive = activeSlug === node.slug;

    return (
      <div key={node.id} className="w-full">
        <div className={`flex items-center justify-between py-2.5 border-b border-gray-50 ${depth > 0 ? 'pl-4' : ''}`}>
          <Link
            href={`/category/${node.slug}`}
            className={`text-sm flex-1 hover:text-accent transition-colors ${isActive ? 'text-primary font-extrabold' : 'text-gray-700 font-medium'}`}
            onClick={() => setMobileOpen(false)}
          >
            {formatCategoryName(node.name)}
          </Link>
          {hasChildren && (
            <button
              onClick={() => toggleExpand(node.id)}
              className={`p-1.5 rounded-md transition-colors ${isExpanded ? 'bg-primary/5 text-primary' : 'text-gray-400 hover:text-primary hover:bg-gray-50'}`}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="flex flex-col mb-1 border-l-2 border-gray-100 ml-2 mt-1">
            {node.children.map((child: any) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full">
      {/* Mobile toggle */}
      <button
        className={`md:hidden flex items-center gap-3 w-full py-3.5 px-4 font-bold uppercase tracking-widest text-sm transition-all
          ${mobileOpen ? 'bg-primary text-white' : 'bg-white border-2 border-gray-200 text-primary hover:border-primary'}
        `}
        onClick={() => setMobileOpen(o => !o)}
      >
        <SlidersHorizontal className="w-4 h-4" />
        <span>Browse Categories</span>
        <ChevronDown className={`w-5 h-5 ml-auto transition-transform ${mobileOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* List — always visible on md+, toggled on mobile */}
      <div className={`${mobileOpen ? 'block animate-in slide-in-from-top-2 mt-3' : 'hidden'} md:block bg-white p-4 md:p-0 border-2 md:border-0 border-gray-100 shadow-sm md:shadow-none`}>
        <h3 className="hidden md:block text-lg font-extrabold text-gray-900 mb-4 uppercase tracking-tight pb-3 border-b-2 border-primary">Shop by Category</h3>
        <div className="flex flex-col">
          {tree.map(node => renderNode(node))}
        </div>
      </div>
    </div>
  );
}
