const KIT_DESIGNER_URL = "#";
const kitDesignerPattern = /(Kit Designer)/gi;

export function KitDesignerText({ children }: { children: string | null | undefined }) {
  if (!children) return null;

  return (
    <>
      {children.split(kitDesignerPattern).map((part, index) =>
        part.toLowerCase() === "kit designer" ? (
          <a
            key={index}
            href={KIT_DESIGNER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
          >
            {part}
          </a>
        ) : part,
      )}
    </>
  );
}