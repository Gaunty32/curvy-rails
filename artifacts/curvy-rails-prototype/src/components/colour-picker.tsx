import type { ProductColour } from '@/data/types';

export function ColourPicker({ colours, value, onChange }: {
  colours: ProductColour[];
  value: ProductColour;
  onChange: (colour: ProductColour) => void;
}) {
  return (
    <div role="group" aria-label="Product colour" className="flex flex-wrap gap-2">
      {colours.map((colour) => (
        <button key={colour} type="button" data-testid={`button-colour-${colour.toLowerCase()}`}
          aria-pressed={value === colour} onClick={() => onChange(colour)}
          className={`inline-flex min-h-11 min-w-28 items-center justify-center gap-2 border px-4 text-sm font-semibold ${value === colour ? 'border-black bg-black text-white' : 'border-neutral-300 bg-white text-black hover:border-black'}`}>
          <span aria-hidden="true" className={`h-4 w-4 rounded-full border ${colour === 'Black' ? 'border-neutral-400 bg-black' : 'border-neutral-300 bg-white'}`} />
          {colour}
        </button>
      ))}
    </div>
  );
}
