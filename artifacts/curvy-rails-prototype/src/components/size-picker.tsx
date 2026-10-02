export function SizePicker({ sizes, value, onChange }: { sizes: number[]; value: number | null; onChange: (s: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Size (UK)" className="grid grid-cols-5 gap-2">
      {sizes.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} data-testid={`button-size-${s}`} onClick={() => onChange(s)}
          className={`h-11 min-w-11 border border-black text-sm font-semibold ${value === s ? 'bg-black text-white' : 'bg-white hover:bg-secondary'}`}>{s}</button>
      ))}
    </div>
  );
}
