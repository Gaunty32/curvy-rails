import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Loader2, ShoppingBag, ArrowRight, Clock, CheckCircle2, XCircle, Package, AlertCircle, User,
  Hash, Pencil, Check, X, Tags, Gift, Star, History, ChevronDown, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { getPortalOrderLifecycle } from "@/lib/order-status";

// ─── Smart welcome message ────────────────────────────────────────────────────

type WelcomeMessage = { greeting: string; body: string; emoji: string };

function getWelcomeMessage(firstName: string): WelcomeMessage {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Sun, 6=Sat
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // Weekend
  if (dow === 0 || dow === 6) {
    const msgs = [
      { body: "Working on a weekend? We're pleased to see you — but don't forget, weekends are for enjoying yourself too! 😄", emoji: "☀️" },
      { body: "A weekend visit? Your dedication is impressive. Just make sure you switch off properly — the orders will still be here on Monday!", emoji: "🌿" },
      { body: "Great to see you're keeping on top of things, even on the weekend. You deserve a treat after this!", emoji: "🎉" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Hi ${firstName}`, ...pick };
  }

  // Late night (after 8pm)
  if (hour >= 20) {
    const msgs = [
      { body: "Working late? Don't burn the candle at both ends — we'll still be here tomorrow morning, bright and early.", emoji: "🕯️" },
      { body: "Burning the midnight oil? That's commitment! Just don't forget to rest — your best ideas come when you're refreshed.", emoji: "🌙" },
      { body: "Late night session? Make sure you close the laptop soon. Tomorrow is a new day with new opportunities.", emoji: "⭐" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Hi ${firstName}`, ...pick };
  }

  // Early morning (before 8am)
  if (hour < 8) {
    const msgs = [
      { body: "The early bird certainly catches the worm! You're ahead of the pack before most people have even had breakfast.", emoji: "🐦" },
      { body: "Morning! You're up bright and early. The office is all yours — the best ideas happen in the quiet hours!", emoji: "🌅" },
      { body: "Rise and shine! There's something special about the early morning — a head start on the whole day.", emoji: "☕" },
    ];
    const pick = msgs[day % msgs.length];
    return { greeting: `Morning ${firstName}`, ...pick };
  }

  // ── Weekday business hours: fun date fact ─────────────────────────────────

  // Notable specific dates (month/day)
  const notable: Record<string, { body: string; emoji: string }> = {
    "1/1":  { body: "Happy New Year! A fresh start, a blank page — make it a great one.", emoji: "🎆" },
    "1/25": { body: "It's Burns Night! Scotland celebrates Robert Burns tonight with haggis, neeps, tatties and a good dram.", emoji: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
    "2/2":  { body: "It's Groundhog Day! The famous American tradition where a groundhog predicts the weather — though we'll trust the Met Office.", emoji: "🦡" },
    "2/14": { body: "Happy Valentine's Day! 💌 Did you know over a billion Valentine's Day cards are sent worldwide every year?", emoji: "❤️" },
    "3/1":  { body: "Happy St David's Day! A daffodil or leek for everyone from Wales today.", emoji: "🌼" },
    "3/14": { body: "It's Pi Day (3.14)! Mathematicians everywhere are celebrating the most famous number — 3.14159265...", emoji: "🥧" },
    "3/17": { body: "Happy St Patrick's Day! Over 13 million pints of Guinness are consumed globally today. Sláinte!", emoji: "🍀" },
    "4/1":  { body: "April Fools' Day! We promise there are no tricks in your order system today. Probably.", emoji: "🤡" },
    "4/22": { body: "It's Earth Day! Since 1970, over a billion people worldwide take part in events to protect our planet.", emoji: "🌍" },
    "4/23": { body: "Happy St George's Day! Also Shakespeare's birthday — he was born AND died on 23rd April, 1564 and 1616.", emoji: "🌹" },
    "5/4":  { body: "May the 4th be with you! Star Wars Day is celebrated by fans in over 130 countries.", emoji: "⭐" },
    "5/8":  { body: "It's VE Day — marking the end of World War II in Europe in 1945. A day to remember those who served.", emoji: "🕊️" },
    "6/21": { body: "Happy Summer Solstice! Today is the longest day of the year — enjoy that extra daylight!", emoji: "🌞" },
    "6/23": { body: "It's National Pink Day! Did you know pink was originally considered a masculine colour in the 18th century?", emoji: "🌸" },
    "7/4":  { body: "American Independence Day! The US Declaration of Independence was signed on this day in 1776.", emoji: "🦅" },
    "8/12": { body: "It's World Elephant Day! There are around 415,000 African elephants remaining in the wild — every one matters.", emoji: "🐘" },
    "9/5":  { body: "It's International Day of Charity! A great reminder that even small acts of kindness add up.", emoji: "💛" },
    "9/22": { body: "Happy Autumn Equinox! Day and night are roughly equal today — autumn is officially here.", emoji: "🍂" },
    "10/4": { body: "It's World Animal Day! Celebrating the welfare of animals around the globe.", emoji: "🐾" },
    "10/31": { body: "Happy Halloween! 👻 The tradition of carving pumpkins actually started with turnips in Ireland and Scotland.", emoji: "🎃" },
    "11/5": { body: "Remember, remember the 5th of November! Bonfire Night marks Guy Fawkes' failed Gunpowder Plot of 1605.", emoji: "🎇" },
    "11/11": { body: "Remembrance Day. At 11am on 11 November 1918, the guns fell silent on the Western Front. We remember.", emoji: "🌺" },
    "12/21": { body: "Winter Solstice — the shortest day of the year. From here, the days start getting longer again!", emoji: "❄️" },
    "12/24": { body: "Christmas Eve! Last-minute preparations are underway across the nation. Hope you've finished your shopping!", emoji: "🎄" },
    "12/25": { body: "Merry Christmas! 🎅 Did you know the average UK household receives 17 Christmas cards every year?", emoji: "🎁" },
    "12/31": { body: "New Year's Eve! Tonight, 7 billion people across 24 time zones will welcome in the new year.", emoji: "🥂" },
  };

  const key = `${month}/${day}`;
  if (notable[key]) {
    return { greeting: `Hi ${firstName}`, ...notable[key] };
  }

  // ── Seasonal pool (used as fallback, picked by day-of-year so it's consistent all day) ──
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  const seasonal: WelcomeMessage[] = [
    // ── Facts ──────────────────────────────────────────────────────────────
    { greeting: `Hi ${firstName}`, emoji: "🐝", body: "Fun fact: Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs — and it was still perfectly edible." },
    { greeting: `Hi ${firstName}`, emoji: "🦈", body: "Fun fact: Sharks are older than trees. Sharks have existed for around 450 million years; trees only appeared about 360 million years ago." },
    { greeting: `Hi ${firstName}`, emoji: "📚", body: "Fun fact: Oxford University is older than the Aztec Empire. Teaching began there around 1096; the Aztec Empire wasn't founded until 1428." },
    { greeting: `Hi ${firstName}`, emoji: "🌍", body: "Fun fact: Scotland's national animal is the unicorn — adopted as a royal symbol in the 12th century. Magnificent choice." },
    { greeting: `Hi ${firstName}`, emoji: "🚀", body: "Fun fact: The footprints left on the Moon will last at least 100 million years. There's no wind or weather to erode them." },
    { greeting: `Hi ${firstName}`, emoji: "⚔️", body: "Fun fact: The shortest war in recorded history lasted just 38 minutes — the Anglo-Zanzibar War of 1896. A decisive result." },
    { greeting: `Hi ${firstName}`, emoji: "🌿", body: "Fun fact: Bamboo is the fastest-growing plant on Earth — certain species can grow up to 91cm in a single day." },
    { greeting: `Hi ${firstName}`, emoji: "🏛️", body: "Fun fact: Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid of Giza. History is wild." },
    { greeting: `Hi ${firstName}`, emoji: "🎮", body: "Fun fact: Nintendo was founded in 1889 — as a playing card company. They didn't make video games for another 85 years." },
    { greeting: `Hi ${firstName}`, emoji: "☕", body: "Fun fact: The world's first webcam was invented at Cambridge University — solely to monitor a coffee pot, so staff wouldn't trek to find it empty." },
    { greeting: `Hi ${firstName}`, emoji: "⌨️", body: "Fun fact: The QWERTY keyboard was designed in the 1870s to slow typists down and prevent mechanical keys from jamming." },
    { greeting: `Hi ${firstName}`, emoji: "🐦", body: "Fun fact: Crows can recognise and remember individual human faces — and hold grudges. Best stay on their good side." },
    { greeting: `Hi ${firstName}`, emoji: "🔤", body: "Fun fact: The dot above a lowercase 'i' or 'j' has a name — it's called a tittle. Now you know." },
    { greeting: `Hi ${firstName}`, emoji: "🦢", body: "Fun fact: All mute swans in England are owned by the Crown. The annual Swan Upping ceremony on the Thames dates back to the 12th century." },
    { greeting: `Hi ${firstName}`, emoji: "💬", body: "Fun fact: The word 'queue' is the only English word that sounds exactly the same if you remove the last four letters." },
    { greeting: `Hi ${firstName}`, emoji: "🐌", body: "Fun fact: Snails can sleep for up to three years at a stretch, waiting for the right conditions to wake up." },
    { greeting: `Hi ${firstName}`, emoji: "👕", body: "Fun fact: The T-shirt gets its name simply from its shape — when laid flat, it looks exactly like the letter T." },
    { greeting: `Hi ${firstName}`, emoji: "👖", body: "Fun fact: Levi Strauss patented blue jeans on 20 May 1873. They were designed as tough workwear for Gold Rush miners, not a fashion statement." },
    { greeting: `Hi ${firstName}`, emoji: "🏇", body: "Fun fact: The polo shirt was designed for polo players to keep cool during matches. The collar was meant to stop it flapping in the wind." },
    { greeting: `Hi ${firstName}`, emoji: "🌱", body: "Fun fact: Velcro was invented in 1941 after Swiss engineer George de Mestral noticed burdock burrs stuck to his dog's fur after a walk." },
    { greeting: `Hi ${firstName}`, emoji: "🐙", body: "Fun fact: Octopuses have three hearts, blue blood, and nine brains — one central brain and a mini-brain in each of their eight arms." },
    { greeting: `Hi ${firstName}`, emoji: "♟️", body: "Fun fact: There are more possible games of chess than atoms in the observable universe. Roughly 10 to the power of 120, if you're counting." },
    { greeting: `Hi ${firstName}`, emoji: "⏱️", body: "Fun fact: A 'jiffy' is a genuine unit of time — specifically 1/100th of a second. So now you can correctly say 'back in a jiffy'." },
    { greeting: `Hi ${firstName}`, emoji: "🦩", body: "Fun fact: A group of flamingos is called a flamboyance. A group of owls is a parliament. A group of cats is a clowder. English is wonderful." },
    { greeting: `Hi ${firstName}`, emoji: "🌙", body: "Fun fact: The Moon is drifting away from Earth at about 3.8cm per year — roughly the same rate your fingernails grow." },
    { greeting: `Hi ${firstName}`, emoji: "🏰", body: "Fun fact: Windsor Castle has been continuously occupied for nearly 1,000 years, making it the oldest and largest inhabited castle in the world." },
    { greeting: `Hi ${firstName}`, emoji: "🎭", body: "Fun fact: The word 'robot' comes from the Czech 'robota', meaning forced drudgery. It was coined in a 1921 play by Karel Čapek." },
    { greeting: `Hi ${firstName}`, emoji: "🌈", body: "Fun fact: No two people ever see the same rainbow. Because the angle of refraction is unique to each observer, every rainbow is personal." },
    // ── Jokes ──────────────────────────────────────────────────────────────
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Why don't scientists trust atoms? Because they make up everything." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I used to hate facial hair, but then it grew on me." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I'm reading a book on anti-gravity. It's impossible to put down." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Why did the scarecrow win an award? Because he was outstanding in his field." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I've started telling everyone about the benefits of eating dried grapes. It's all about raisin awareness." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: My wife said I had to stop acting like a flamingo. I had to put my foot down." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: What do you call a fish without eyes? A fsh." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I told my boss three companies were after me and I needed a raise. He asked which companies. I said the gas, electric and water." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Time flies like an arrow. Fruit flies like a banana." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Why did the bicycle fall over? Because it was two-tired." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I'm on a seafood diet. I see food and I eat it." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Why can't you explain puns to kleptomaniacs? They always take things literally." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: What do you call someone who can't stop buying carpets? A rug addict." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I asked my dog what two minus two is. He said nothing." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: What's the best thing about Switzerland? I don't know, but the flag is a big plus." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: I tried to come up with a carpentry joke, but I couldn't think of one. I'm working on it." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: A skeleton walks into a bar and orders a pint of lager and a mop." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: Why do cows wear bells? Because their horns don't work." },
    { greeting: `Hi ${firstName}`, emoji: "😄", body: "Joke of the day: What do you call a parade of rabbits hopping backwards? A receding hare line." },
  ];

  return seasonal[dayOfYear % seasonal.length];
}

function StatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  const lifecycle = getPortalOrderLifecycle(status, portalStatus);
  if (lifecycle === "pending_approval") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1"><AlertCircle className="w-3 h-3" />Awaiting approval</Badge>;
  }
  if (lifecycle === "pending_sbs") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1"><Clock className="w-3 h-3" />Pending review</Badge>;
  }
  if (lifecycle === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1"><Clock className="w-3 h-3" />Submitted to supplier</Badge>;
  }
  if (lifecycle === "rejected") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  }
  if (lifecycle === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">In production</Badge>;
  if (lifecycle === "part_shipped") return <Badge className="bg-indigo-100 text-indigo-800 border-transparent">Part shipped</Badge>;
  if (lifecycle === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent">Shipped</Badge>;
  if (lifecycle === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent">Delivered</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function ManagerReviewPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { canSeePricing } = useAuth();

  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkSubmitOpen, setBulkSubmitOpen] = useState(false);
  const [bulkPoNumber, setBulkPoNumber] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Inline per-order PO editing
  const [editingPoId, setEditingPoId] = useState<number | null>(null);
  const [poInputValue, setPoInputValue] = useState("");

  const setPoMutation = useMutation({
    mutationFn: ({ orderId, poNumber }: { orderId: number; poNumber: string }) =>
      apiFetch(`/portal/orders/${orderId}/po`, {
        method: "PATCH",
        body: JSON.stringify({ poNumber: poNumber.trim() }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      setEditingPoId(null);
    },
    onError: () => toast({ title: "Could not save PO number", variant: "destructive" }),
  });

  const { data: pendingOrders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-manager-pending"],
    queryFn: () => apiFetch("/portal/manager/pending-orders"),
    refetchInterval: 15_000,
  });

  useEffect(() => { setSelected(new Set()); }, [pendingOrders]);

  const allSelected = pendingOrders.length > 0 && selected.size === pendingOrders.length;
  const someSelected = selected.size > 0;
  const selectedOrders = pendingOrders.filter((o: any) => selected.has(o.id));
  const selectedTotal = selectedOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || "0"), 0);
  const selectedItemCount = selectedOrders.reduce((sum: number, o: any) => sum + Number(o.item_count || 0), 0);

  function toggleSelect(id: number) {
    const selectedOrder = pendingOrders.find((order: any) => order.id === id);
    const linkedIds = selectedOrder?.fulfilment_group_id
      ? pendingOrders
          .filter((order: any) => order.fulfilment_group_id === selectedOrder.fulfilment_group_id)
          .map((order: any) => order.id)
      : [id];
    setSelected(prev => {
      const n = new Set(prev);
      const isEntireLinkedSetSelected = linkedIds.every(linkedId => n.has(linkedId));
      for (const linkedId of linkedIds) {
        if (isEntireLinkedSetSelected) n.delete(linkedId);
        else n.add(linkedId);
      }
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pendingOrders.map((o: any) => o.id)));
  }

  const bulkSubmitMutation = useMutation({
    mutationFn: async ({ orderIds, poNumber }: { orderIds: number[]; poNumber: string }) => {
      await Promise.all(
        orderIds.map(orderId =>
          apiFetch(`/portal/manager/orders/${orderId}/submit`, {
            method: "POST",
            body: JSON.stringify({ poNumber: poNumber.trim() || null }),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      const count = selected.size;
      setBulkSubmitOpen(false);
      setBulkPoNumber("");
      setSelected(new Set());
      toast({ title: `${count} order${count !== 1 ? "s" : ""} approved` });
    },
    onError: (e: any) => toast({ title: "Error submitting orders", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) =>
      apiFetch(`/portal/manager/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Order rejected" });
    },
  });

  if (isLoading) return null;
  if (pendingOrders.length === 0) return null;

  return (
    <>
      <Card className="mb-6 border-orange-200 bg-orange-50/40 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-base flex items-center gap-2 text-orange-800">
            <AlertCircle className="w-4 h-4" />
            Orders awaiting your approval
            <Badge className="ml-auto bg-orange-500 text-white tabular-nums">{pendingOrders.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-5 py-2 border-b border-orange-100 text-xs font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-orange-300 accent-orange-600 cursor-pointer shrink-0"
              aria-label="Select all orders"
            />
            <span className="flex-1">Order / Placed by</span>
            <span className="w-20 text-right hidden sm:block">Items</span>
            <span className="w-24 text-right">Value</span>
            <span className="w-16 text-right">Action</span>
          </div>

          {/* Order rows */}
          <div className="divide-y divide-orange-100">
            {pendingOrders.map((order: any) => (
              <div
                key={order.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 transition-colors",
                  selected.has(order.id) ? "bg-orange-100/70" : "hover:bg-orange-50/70"
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(order.id)}
                  onChange={() => toggleSelect(order.id)}
                  onClick={e => e.stopPropagation()}
                  className="h-4 w-4 rounded border-orange-300 accent-orange-600 cursor-pointer shrink-0"
                  aria-label={`Select order ${order.order_number}`}
                />

                {/* Clickable info area → order detail */}
                <div className="flex-1 min-w-0">
                  <button
                    className="w-full text-left group"
                    onClick={() => setLocation(`/orders/${order.id}`)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-primary text-sm group-hover:underline underline-offset-2">
                        {order.order_number}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(order.order_date)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <User className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">
                        {order.portal_submitted_by_name ?? "Unknown"}
                      </span>
                    </div>
                    {order.portal_notes && (
                      <p className="text-xs text-muted-foreground italic truncate mt-0.5 max-w-[260px]">
                        {order.portal_notes}
                      </p>
                    )}
                  </button>

                  {/* Inline PO number per order */}
                  {editingPoId === order.id ? (
                    <form
                      className="flex items-center gap-1 mt-1"
                      onSubmit={e => {
                        e.preventDefault();
                        setPoMutation.mutate({ orderId: order.id, poNumber: poInputValue });
                      }}
                    >
                      <Input
                        autoFocus
                        value={poInputValue}
                        onChange={e => setPoInputValue(e.target.value)}
                        placeholder="PO number"
                        className="h-6 text-xs w-36 px-2"
                        maxLength={100}
                        onKeyDown={e => { if (e.key === "Escape") setEditingPoId(null); }}
                      />
                      <Button type="submit" size="icon" className="h-6 w-6" disabled={setPoMutation.isPending}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => setEditingPoId(null)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </form>
                  ) : (
                    <button
                      className="flex items-center gap-1 mt-1 group/po text-xs text-muted-foreground hover:text-foreground"
                      onClick={e => { e.stopPropagation(); setPoInputValue(order.po_number ?? ""); setEditingPoId(order.id); }}
                    >
                      {order.po_number
                        ? <><Hash className="w-3 h-3 shrink-0" /><span className="font-medium text-foreground/80">{order.po_number}</span><Pencil className="w-2.5 h-2.5 opacity-0 group-hover/po:opacity-60 transition-opacity" /></>
                        : <span className="italic opacity-60 hover:opacity-100 transition-opacity">+ Add PO number</span>
                      }
                    </button>
                  )}
                </div>

                <span className="w-20 text-right text-sm text-muted-foreground tabular-nums hidden sm:block">
                  {order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}
                </span>
                {canSeePricing && (
                  <span className="w-24 text-right font-semibold text-sm tabular-nums">
                    {formatCurrency(order.total_amount)}
                  </span>
                )}
                <div className="w-16 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setRejectTarget(order)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Bulk action bar — appears when orders are selected */}
          {someSelected ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-5 py-3 border-t-2 border-orange-200 bg-orange-100/60">
              <div className="text-sm font-medium text-orange-900">
                {selected.size} order{selected.size !== 1 ? "s" : ""} selected
                <span className="mx-2 text-orange-300">|</span>
                {canSeePricing && <>Total: <span className="font-bold">{formatCurrency(selectedTotal)}</span></>}
              </div>
              <div className="flex gap-2 sm:ml-auto shrink-0 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-orange-300 text-orange-800 hover:bg-orange-50"
                  onClick={() => setSelected(new Set())}
                >
                  Deselect all
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setBulkSubmitOpen(true)}
                >
                  Approve &amp; Submit ({selected.size})
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-2 border-t border-orange-100">
              <p className="text-xs text-muted-foreground">
                Choose orders above to approve and submit with a PO number, or click an order to view details.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Bulk approve & submit dialog ────────────────────────────────────── */}
      <Dialog open={bulkSubmitOpen} onOpenChange={o => { if (!o) { setBulkSubmitOpen(false); setBulkPoNumber(""); } }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              Approve &amp; Submit {selectedOrders.length} Order{selectedOrders.length !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Order summary table */}
            <div className="rounded-lg border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Order</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Placed by</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Items</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2 font-medium text-primary">{o.order_number}</td>
                      <td className="px-3 py-2 text-muted-foreground">{o.portal_submitted_by_name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{o.item_count}</td>
                      {canSeePricing && <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(o.total_amount)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 border-t-2">
                  <tr>
                    <td colSpan={canSeePricing ? 2 : 3} className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold hidden sm:table-cell">{selectedItemCount} items</td>
                    {canSeePricing && <td className="px-3 py-2 text-right tabular-nums font-bold text-base">{formatCurrency(selectedTotal)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* PO number */}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-po">Purchase Order Number</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Orders sharing a PO will be grouped together for production and invoicing,
                while items are still delivered to each person's team or department.
                Leave blank to assign a PO after approval.
              </p>
              <Input
                id="bulk-po"
                placeholder="e.g. PO-2026-001234"
                value={bulkPoNumber}
                onChange={e => setBulkPoNumber(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkSubmitOpen(false); setBulkPoNumber(""); }}>
              Cancel
            </Button>
            <Button
              disabled={bulkSubmitMutation.isPending}
              onClick={() => bulkSubmitMutation.mutate({ orderIds: Array.from(selected), poNumber: bulkPoNumber })}
            >
              {bulkSubmitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Submit for fulfilment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!rejectTarget} onOpenChange={o => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject order {rejectTarget?.order_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {rejectTarget?.portal_submitted_by_name && (
              <p className="text-sm text-muted-foreground">
                Submitted by <span className="font-medium text-foreground">{rejectTarget.portal_submitted_by_name}</span>
              </p>
            )}
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Let the team member know why this order was rejected…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ orderId: rejectTarget.id, reason: rejectReason })}
            >
              {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { isManager, canApproveOrders, user, canSeePricing } = useAuth();
  const firstName = (user as any)?.firstName ?? "there";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Computed once per render (consistent for the whole session)
  const welcome = useMemo(() => getWelcomeMessage(firstName), [firstName]);

  // Fade banner out after 10 s, then remove from DOM after the 1 s transition
  const [bannerFading, setBannerFading] = useState(false);
  const [bannerGone, setBannerGone] = useState(false);
  useEffect(() => {
    const fade = setTimeout(() => setBannerFading(true), 10_000);
    const gone = setTimeout(() => setBannerGone(true), 11_000);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, []);

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-orders"],
    queryFn: () => apiFetch("/portal/orders"),
  });

  const { data: selectExtraData } = useQuery<{
    offer: { id: number; productName: string; description: string | null; imageUrl: string | null; productUrl: string | null; quantity: number; minSpend: number; title: string } | null;
    claimed: boolean;
    claimOrderNumber: string | null;
  }>({
    queryKey: ["portal-select-extra"],
    queryFn: () => apiFetch("/portal/select-extra/current"),
    enabled: isManager,
  });

  const { data: selectExtraLibrary = [] } = useQuery<Array<{
    id: number; year: number; month: number; title: string; product_name: string;
    description: string | null; image_url: string | null; product_url: string | null;
    quantity: number; min_spend: string;
  }>>({
    queryKey: ["portal-select-extra-library"],
    queryFn: () => apiFetch("/portal/select-extra/library"),
    enabled: isManager,
    staleTime: 60_000,
  });

  const [libraryOpen, setLibraryOpen] = useState(false);

  // ── Batch PO assignment mode (managers only) ────────────────────────────────
  const [poMode, setPoMode] = useState(false);
  const [poSelected, setPoSelected] = useState<Set<number>>(new Set());
  const [batchPoOpen, setBatchPoOpen] = useState(false);
  const [batchPoInput, setBatchPoInput] = useState("");

  function togglePoSelect(id: number) {
    setPoSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function exitPoMode() { setPoMode(false); setPoSelected(new Set()); }

  const batchPoMutation = useMutation({
    mutationFn: ({ orderIds, poNumber }: { orderIds: number[]; poNumber: string }) =>
      apiFetch("/portal/manager/bulk-po", {
        method: "PATCH",
        body: JSON.stringify({ orderIds, poNumber }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      const count = poSelected.size;
      setBatchPoOpen(false);
      setBatchPoInput("");
      exitPoMode();
      toast({ title: `PO number assigned to ${count} order${count !== 1 ? "s" : ""}` });
    },
    onError: (e: any) => toast({ title: "Could not assign PO", description: e.message, variant: "destructive" }),
  });

  const poSelectedOrders = orders.filter((o: any) => poSelected.has(o.id));
  const poSelectedTotal = poSelectedOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || "0"), 0);

  return (
    <PortalLayout>
      {/* Welcome banner — fades out after 10 s */}
      {!bannerGone && (
        <div
          className={`rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 px-6 py-5 mb-6 transition-opacity duration-1000 ${bannerFading ? "opacity-0" : "opacity-100"}`}
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none mt-0.5" role="img" aria-hidden>{welcome.emoji}</span>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{welcome.greeting}</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl leading-relaxed">
                {welcome.body}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Monthly free gift offer (admins only); the API keeps its legacy compatibility route. */}
      {isManager && selectExtraData?.offer && (
        <div className={`rounded-xl border mb-6 overflow-hidden ${selectExtraData.claimed ? "bg-green-50 border-green-200" : "bg-gradient-to-r from-amber-50 via-orange-50/60 to-transparent border-amber-200"}`}>
          <div className="flex items-stretch">

            {/* Left: product thumbnail */}
            {selectExtraData.offer.imageUrl ? (
              <div className="shrink-0 w-24 sm:w-28 bg-white border-r border-amber-100 flex items-center justify-center p-2">
                <img
                  src={selectExtraData.offer.imageUrl}
                  alt={selectExtraData.offer.productName}
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className={`shrink-0 w-16 flex items-center justify-center border-r ${selectExtraData.claimed ? "bg-green-100 border-green-200" : "bg-amber-100 border-amber-200"}`}>
                {selectExtraData.claimed
                  ? <CheckCircle2 className="w-6 h-6 text-green-600" />
                  : <Gift className="w-6 h-6 text-amber-600" />}
              </div>
            )}

            {/* Centre: content */}
            <div className="flex-1 min-w-0 px-4 py-3.5">
              {/* Label row */}
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className={`text-[11px] font-bold uppercase tracking-widest ${selectExtraData.claimed ? "text-green-600" : "text-amber-600"}`}>
                  Monthly gift
                </span>
                <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />
                <span className="text-[11px] text-muted-foreground">{selectExtraData.offer.title.replace(/^[^-—]+[—-]\s*/, "")}</span>
              </div>

              {selectExtraData.claimed ? (
                <>
                  <p className="text-sm font-semibold text-green-800">You've claimed your free gift!</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {selectExtraData.offer.productName} will be included with your{" "}
                    {selectExtraData.claimOrderNumber
                      ? <span>order <strong>{selectExtraData.claimOrderNumber}</strong></span>
                      : "order"}.
                  </p>
                  <p className="text-xs text-green-600/80 mt-1">
                     This gift is available once per customer per month with a qualifying order.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    Free gift with your next order — spend £{selectExtraData.offer.minSpend.toFixed(0)}+ (excl. VAT)
                  </p>
                  <p className="text-xs text-amber-800/90 mt-0.5 max-w-lg leading-relaxed">
                    {selectExtraData.offer.description ?? `Add ${selectExtraData.offer.productName} to your next qualifying order, free of charge.`}
                  </p>
                  <p className="text-xs text-amber-700/80 mt-1">
                     This gift is available once per customer per month with a qualifying order value.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <Button size="sm" className="h-7 text-xs px-3 bg-amber-600 hover:bg-amber-700 gap-1" onClick={() => setLocation("/orders/new?selectExtra=true")}>
                      Add to basket <ShoppingBag className="w-3 h-3" />
                    </Button>
                    {selectExtraData.offer.productUrl && (
                      <a
                        href={selectExtraData.offer.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900"
                      >
                        View product
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Monthly gift library — past offers, visible to managers */}
      {isManager && selectExtraLibrary.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setLibraryOpen(v => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
          >
            <History className="w-4 h-4" />
            <span>Past gift offers</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{selectExtraLibrary.length}</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${libraryOpen ? "rotate-180" : ""}`} />
          </button>
          {libraryOpen && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {selectExtraLibrary.map((past) => (
                <div key={past.id} className="rounded-xl border bg-card p-3 flex gap-3 items-start">
                  {past.image_url ? (
                    <img
                      src={past.image_url}
                      alt={past.product_name}
                      className="w-12 h-12 rounded-lg object-contain shrink-0 bg-muted/30 p-0.5"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Gift className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {new Date(0, past.month - 1).toLocaleString("en-GB", { month: "long" })} {past.year}
                    </p>
                    <p className="text-xs font-semibold leading-tight mt-0.5 line-clamp-2">{past.product_name}</p>
                    {past.product_url && (
                      <a
                        href={past.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline flex items-center gap-0.5 mt-1"
                      >
                        Order at full price <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          {poMode ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Choose orders</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Choose orders to assign a shared PO number</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Track your order history and status</p>
            </>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {isManager && !poMode && orders.length > 0 && (
            <Button variant="outline" onClick={() => setPoMode(true)} className="gap-1.5">
              <Tags className="w-4 h-4" /> Assign PO
            </Button>
          )}
          {poMode && (
            <Button variant="outline" onClick={exitPoMode} className="gap-1.5">
              <X className="w-4 h-4" /> Cancel
            </Button>
          )}
          {!poMode && (
            <Button onClick={() => setLocation("/orders/new")} className="gap-1.5">
              <Plus className="w-4 h-4" /> New Order
            </Button>
          )}
        </div>
      </div>

      {canApproveOrders && !poMode && <ManagerReviewPanel />}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <ShoppingBag className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold text-foreground">No orders yet</h2>
            <p className="text-muted-foreground text-sm mt-1 mb-6">Place your first order to get started</p>
            <Button onClick={() => setLocation("/orders/new")}>
              <Plus className="w-4 h-4 mr-1.5" /> Place an order
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {orders.map((order: any) => (
              <Card
                key={order.id}
                className={cn(
                  "transition-all group",
                  poMode
                    ? cn("cursor-pointer", poSelected.has(order.id) ? "border-primary/60 bg-primary/5 shadow-sm" : "hover:border-primary/40 hover:shadow-sm")
                    : "cursor-pointer hover:border-primary/40 hover:shadow-sm"
                )}
                onClick={() => poMode ? togglePoSelect(order.id) : setLocation(`/orders/${order.id}`)}
              >
                <CardContent className="py-4 px-5 flex items-center gap-4">
                  {poMode ? (
                    <input
                      type="checkbox"
                      checked={poSelected.has(order.id)}
                      onChange={() => togglePoSelect(order.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer shrink-0"
                      aria-label={`Select ${order.order_number}`}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-primary">{order.order_number}</span>
                      <StatusBadge status={order.status} portalStatus={order.portal_status} />
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{formatDate(order.order_date)}</span>
                      <span className="text-border">·</span>
                      <span>{order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}</span>
                      {order.required_date && (
                        <>
                          <span className="text-border">·</span>
                          <span>Required {formatDate(order.required_date)}</span>
                        </>
                      )}
                      {order.po_number && (
                        <>
                          <span className="text-border">·</span>
                          <span className="font-medium text-foreground/70">PO: {order.po_number}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {canSeePricing && <span className="font-semibold tabular-nums">{formatCurrency(order.total_amount)}</span>}
                    {!poMode && (
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Sticky action bar — visible in PO assignment mode */}
          {poMode && (
            <div className={cn(
              "sticky bottom-4 mt-4 rounded-xl border shadow-lg px-5 py-3 flex items-center gap-3 transition-colors",
              poSelected.size > 0
                ? "bg-primary text-primary-foreground border-primary/70"
                : "bg-card border-border"
            )}>
              <div className="flex-1 min-w-0">
                {poSelected.size > 0 ? (
                  <span className="text-sm font-medium">
                    {poSelected.size} order{poSelected.size !== 1 ? "s" : ""} selected
                    {canSeePricing && (<><span className="mx-2 opacity-60">·</span>{formatCurrency(poSelectedTotal)}</>)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Tick orders above to assign a PO number to them</span>
                )}
              </div>
              <Button
                size="sm"
                disabled={poSelected.size === 0}
                variant={poSelected.size > 0 ? "secondary" : "outline"}
                className="shrink-0 gap-1.5"
                onClick={() => { setBatchPoInput(""); setBatchPoOpen(true); }}
              >
                <Tags className="w-3.5 h-3.5" /> Assign PO
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Batch PO assignment dialog ─────────────────────────────────────────── */}
      <Dialog open={batchPoOpen} onOpenChange={o => { if (!o) { setBatchPoOpen(false); setBatchPoInput(""); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Assign PO Number</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              This PO number will be applied to all {poSelected.size} selected order{poSelected.size !== 1 ? "s" : ""}.
              Orders sharing the same PO are grouped together in production and on invoices,
              while items are still delivered to each person's team or department.
            </p>

            {/* Selected order summary */}
            <div className="rounded-lg border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Order</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Current PO</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {poSelectedOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2 font-medium text-primary">{o.order_number}</td>
                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                        {o.po_number ? <span className="font-medium text-foreground/70">{o.po_number}</span> : <span className="italic opacity-50">None</span>}
                      </td>
                      {canSeePricing && <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(o.total_amount)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 border-t-2">
                  <tr>
                    <td colSpan={canSeePricing ? 2 : 3} className="px-3 py-2 font-semibold">Total</td>
                    {canSeePricing && <td className="px-3 py-2 text-right font-bold tabular-nums">{formatCurrency(poSelectedTotal)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-po-input">Purchase Order Number</Label>
              <Input
                id="batch-po-input"
                placeholder="e.g. PO-2026-001234"
                value={batchPoInput}
                onChange={e => setBatchPoInput(e.target.value)}
                autoFocus
                maxLength={100}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBatchPoOpen(false); setBatchPoInput(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!batchPoInput.trim() || batchPoMutation.isPending}
              onClick={() => batchPoMutation.mutate({ orderIds: Array.from(poSelected), poNumber: batchPoInput })}
            >
              {batchPoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Apply to {poSelected.size} Order{poSelected.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
