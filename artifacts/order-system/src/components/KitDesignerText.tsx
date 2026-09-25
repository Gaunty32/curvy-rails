// The installation can replace this URL through the future public config API.
// Do not carry a source-install endpoint into the template.
const KIT_DESIGNER_URL = "";
const kitDesignerPattern = /(Kit Designer)/gi;

export function KitDesignerText({ children }: { children: string | null | undefined }) {
  if (!children) return null;

  return (
    <>
      {children.split(kitDesignerPattern).map((part, index) =>
        part.toLowerCase() === "kit designer" ? (
          KIT_DESIGNER_URL ? <a
            key={index}
            href={KIT_DESIGNER_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
          >
            {part}
          </a> : <span key={index}>{part}</span>
        ) : part,
      )}
    </>
  );
}