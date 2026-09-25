import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, GripHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

// ─── Drag hook ────────────────────────────────────────────────────────────────
// Tracks pixel offset from the initial centred position.
// All state lives in refs during the drag; offset state only updates on
// mousemove so React re-renders are minimal.
function useDraggable() {
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const drag = React.useRef({ active: false, startMx: 0, startMy: 0, startOx: 0, startOy: 0 })

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active) return
      setOffset({
        x: drag.current.startOx + (e.clientX - drag.current.startMx),
        y: drag.current.startOy + (e.clientY - drag.current.startMy),
      })
    }
    const onUp = (e: MouseEvent) => {
      if (!drag.current.active) return
      drag.current.startOx += e.clientX - drag.current.startMx
      drag.current.startOy += e.clientY - drag.current.startMy
      drag.current.active = false
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const onMouseDown = React.useCallback((e: React.MouseEvent) => {
    // Don't start a drag when clicking interactive elements inside the handle
    const t = e.target as HTMLElement
    if (t.closest('button, input, select, textarea, a, [role="combobox"], [role="option"], [role="listbox"], [role="menuitem"]')) return
    e.preventDefault()
    drag.current.active = true
    drag.current.startMx = e.clientX
    drag.current.startMy = e.clientY
  }, [])

  return { offset, onMouseDown }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────
// Lighter + pointer-events-none so you can read content behind the dialog.
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/25 pointer-events-none",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// ─── Content ──────────────────────────────────────────────────────────────────
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { offset, onMouseDown } = useDraggable()

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Positioned via inline style; transform only centres
          "fixed z-50 grid w-full max-w-lg gap-4 border bg-background shadow-xl",
          "pt-8 pb-6 px-6",           // extra top padding for drag handle
          "sm:rounded-lg",
          // Fade in/out only — slide/zoom would conflict with inline transform
          "duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        style={{
          left: `calc(50% + var(--sidebar-offset) + ${offset.x}px)`,
          top: `calc(50% + ${offset.y}px)`,
          transform: "translate(-50%, -50%)",
        }}
        {...props}
      >
        {/* ── Drag handle ── */}
        <div
          onMouseDown={onMouseDown}
          className="absolute inset-x-0 top-0 h-8 rounded-t-lg cursor-grab active:cursor-grabbing flex items-center justify-center select-none"
          title="Drag to move"
        >
          <GripHorizontal className="w-5 h-5 text-muted-foreground/30" />
        </div>

        {children}

        <DialogPrimitive.Close className="absolute right-4 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-10">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

// ─── Supporting components ────────────────────────────────────────────────────
const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
