import { useState, type ChangeEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageHead } from '@/lib/use-page-head';
import { asset, catalogue, gbp, sizeRange, useProducts } from '@/data/catalogue';
import { ALL_SIZES, PRODUCT_PRICES, productForColour, type Product } from '@/data/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const blank = (): Product => ({ id: `p${Date.now()}`, slug: '', name: '', category: 'tshirt', colour: 'Black', price: PRODUCT_PRICES.tshirt, sizes: [...ALL_SIZES], description: '', image: 'assets/p1.jpg', placeholder: true });
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function downscale(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error('read failed'));
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 800 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = img.width * k; c.height = img.height * k;
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => rej(new Error('bad image'));
      img.src = r.result as string;
    };
    r.readAsDataURL(file);
  });
}

export default function Admin() {
  usePageHead('Demo catalogue editor', 'Browser-local demo catalogue editor for Curvy Rails. Not a secure admin.');
  const products = useProducts();
  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [del, setDel] = useState<Product | null>(null);
  const [err, setErr] = useState('');

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !(editing.price > 0) || editing.sizes.length === 0) { setErr('Name, a price above zero and at least one size are required.'); return; }
    let slug = slugify(editing.name);
    if (products.some((p) => p.slug === slug && p.id !== editing.id)) slug += `-${editing.id.slice(-4)}`;
    catalogue.save({ ...editing, name: editing.name.trim(), slug });
    setEditing(null);
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !editing) return;
    try { setEditing({ ...editing, image: await downscale(f), placeholder: false }); } catch { setErr('Could not read that image.'); }
  };
  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([catalogue.exportJson()], { type: 'application/json' }));
    a.download = 'curvy-rails-catalogue.json'; a.click();
  };
  const field = 'mt-1 min-h-11 w-full border border-black bg-white p-2 text-base';
  const set = (patch: Partial<Product>) => editing && setEditing({ ...editing, ...patch });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <h1 className="font-display text-4xl uppercase md:text-5xl">Demo catalogue editor</h1>
      <p data-testid="text-admin-warning" className="mt-3 border border-black bg-amber-100 p-3 text-sm">
        This is not a secure admin. There is no login: anyone opening this public demo can use it. Changes are saved only in this browser (localStorage) and are not shared with other visitors. A real admin with authentication and a server database replaces this in production.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button data-testid="button-new-product" onClick={() => { setEditing(blank()); setIsNew(true); setErr(''); }} className="flex h-11 items-center gap-2 bg-black px-4 text-xs font-bold uppercase tracking-widest text-white"><Plus className="h-4 w-4" /> New product</button>
        <button data-testid="button-export" onClick={exportJson} className="h-11 border border-black px-4 text-xs font-bold uppercase tracking-widest">Export JSON</button>
        <button data-testid="button-reset" onClick={() => { if (window.confirm('Reset the catalogue to the 10 seeded demo products?')) catalogue.reset(); }} className="h-11 border border-black px-4 text-xs font-bold uppercase tracking-widest">Reset catalogue</button>
      </div>
      <ul className="mt-6 divide-y border-y">
        {products.length === 0 && <li className="p-8 text-center text-sm">No products. Create one or reset the catalogue.</li>}
        {products.map((p) => (
          <li key={p.id} data-testid={`row-admin-${p.id}`} className="flex items-center gap-3 py-3">
            <img src={asset(p.image)} alt="" loading="lazy" className="h-14 w-14 shrink-0 object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{gbp(p.price)} &middot; sizes {sizeRange(p.sizes)} {p.placeholder && <span className="ml-1 bg-black px-1 text-[10px] uppercase text-white">Placeholder</span>}</p>
            </div>
            <button aria-label={`Edit ${p.name}`} data-testid={`button-edit-${p.id}`} onClick={() => { setEditing({ ...p }); setIsNew(false); setErr(''); }} className="flex h-11 w-11 shrink-0 items-center justify-center"><Pencil className="h-4 w-4" /></button>
            <button aria-label={`Delete ${p.name}`} data-testid={`button-delete-${p.id}`} onClick={() => setDel(p)} className="flex h-11 w-11 shrink-0 items-center justify-center"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display uppercase">{isNew ? 'New product' : 'Edit product'}</DialogTitle><DialogDescription>Saved in this browser only.</DialogDescription></DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <label className="block font-semibold">Name<input data-testid="input-product-name" className={field} value={editing.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="font-semibold">Type<select className={field} value={editing.category} onChange={(e) => { const category = e.target.value as Product['category']; set({ category, price: PRODUCT_PRICES[category] }); }}><option value="tshirt">T-Shirt</option><option value="hoodie">Hoodie</option></select></label>
                <label className="font-semibold">Colour<select className={field} value={editing.colour} onChange={(e) => { const colour = e.target.value as Product['colour']; const variant = productForColour(editing, colour); set({ colour, image: variant.image, images: variant.images }); }}><option>Black</option><option>White</option></select></label>
                <label className="font-semibold">Price (£, incl. VAT)<input data-testid="input-product-price" type="number" readOnly className={field} value={PRODUCT_PRICES[editing.category]} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Set by product type: tees £20, hoodies £35.</span></label>
              </div>
              {editing.variants && <p className="text-xs text-muted-foreground">This sets the default display colour. Image edits apply to this colour only; the other colour’s images are preserved.</p>}
              <div><p className="font-semibold">Sizes</p>
                <div className="mt-1 flex flex-wrap gap-2">{ALL_SIZES.map((s) => { const on = editing.sizes.includes(s); return <button key={s} type="button" aria-pressed={on} onClick={() => set({ sizes: on ? editing.sizes.filter((x) => x !== s) : [...editing.sizes, s].sort() })} className={`h-11 min-w-24 px-3 border border-black ${on ? 'bg-black text-white' : ''}`}>{s}</button>; })}</div>
              </div>
              <label className="block font-semibold">Description<textarea rows={3} className={field} value={editing.description} onChange={(e) => set({ description: e.target.value })} /></label>
              <div className="flex gap-3">
                <img src={asset(editing.image)} alt="" className="h-20 w-20 object-cover" />
                <div className="flex-1"><label className="block font-semibold">Image URL or path<input className={field} value={editing.image.startsWith('data:') ? '(uploaded image)' : editing.image} readOnly={editing.image.startsWith('data:')} onChange={(e) => set({ image: e.target.value })} /></label>
                  <input type="file" accept="image/*" onChange={upload} className="mt-2 text-xs" aria-label="Upload image" /></div>
              </div>
              <label className="flex min-h-11 items-center gap-2"><input className="h-5 w-5" type="checkbox" checked={editing.placeholder} onChange={(e) => set({ placeholder: e.target.checked })} /> Mark as placeholder product/image</label>
              {err && <p role="alert" className="text-destructive">{err}</p>}
              <button data-testid="button-save-product" onClick={save} className="h-11 w-full bg-black text-xs font-bold uppercase tracking-widest text-white">Save product</button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {del?.name}?</AlertDialogTitle><AlertDialogDescription>Removes it from this browser's demo catalogue. You can reset to the seed data at any time.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-delete" onClick={() => { if (del) catalogue.remove(del.id); setDel(null); }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
