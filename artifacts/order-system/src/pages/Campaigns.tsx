import React, { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Megaphone, Newspaper, Users, Clock, Send, CheckCircle2, 
  AlertTriangle, Play, Save, ChevronRight, Eye, Code, TestTube2, 
  Loader2, Globe, Calendar, CalendarClock, TagIcon, RefreshCw
} from "lucide-react";
import { 
  useArticles, useTags, useAudiencePreview, useCampaigns, 
  useSaveCampaign, useTestCampaign, useScheduleCampaign, 
  useResolveUncertainCampaign, useCampaignStats,
  Article, Campaign, CampaignStats, AudienceMode
} from "@/hooks/use-campaigns";
import { cn } from "@/lib/utils";

function knowledgeCentreUrl(link: string): string {
  try {
    const url = new URL(link);
    const slug = url.pathname.split("/").filter(Boolean).pop();
    return link;
  } catch {
    return link;
  }
}

function formatStatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

function formatStatRate(value: number): string {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
}

function buildBrandedHtml(article: Article) {
  const previewText = article.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 700);
  const articleUrl = knowledgeCentreUrl(article.link);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', 'Helvetica Neue', sans-serif; background-color: #f4f6f8; margin: 0; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .header { background-color: #1B2B48; padding: 24px; text-align: center; color: #ffffff; }
    .header-title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .hero { width: 100%; height: auto; display: block; background-color: #e2e8f0; min-height: 200px; object-fit: cover; }
    .content { padding: 40px 32px; color: #1e293b; }
    .title { font-size: 26px; font-weight: 800; margin-top: 0; margin-bottom: 12px; color: #0f172a; line-height: 1.2; }
    .meta { font-size: 13px; color: #64748b; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .excerpt { font-size: 18px; color: #334155; line-height: 1.6; margin-bottom: 32px; font-weight: 500; }
    .body-text { font-size: 16px; line-height: 1.7; color: #475569; }
    .body-text p { margin-top: 0; margin-bottom: 20px; }
    .btn-container { text-align: center; margin-top: 40px; margin-bottom: 10px; }
    .btn { display: inline-block; background-color: #6FA8D3; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; transition: background-color 0.2s; }
    .btn:hover { background-color: #5c93bd; }
    .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 28px 24px 30px; text-align: center; font-size: 13px; color: #64748b; line-height: 1.5; }
    .footer p { margin: 0; }
    .footer .preference-copy { margin-top: 6px; }
    .footer a { display: inline-block; margin-top: 14px; color: #1B2B48; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
    .footer a:hover { color: #6FA8D3; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 class="header-title">Your business</h2>
    </div>
    ${article.imageUrl ? `<img class="hero" src="${article.imageUrl}" alt="${article.title.replace(/"/g, '&quot;')}" />` : ''}
    <div class="content">
      <h1 class="title">${article.title}</h1>
      <div class="meta">${article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
      <div class="excerpt">${article.excerpt}</div>
      <div class="body-text">
        <p>${previewText}${previewText.length >= 700 ? "…" : ""}</p>
      </div>
      <div class="btn-container">
        <a href="${articleUrl}" class="btn">Read Full Article</a>
        <a href="#" class="btn" style="margin-left:8px;background-color:#1B2B48">Open the website</a>
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Your business.</p>
      <p class="preference-copy">You are receiving this email because you opted in to updates.</p>
      <a href="{{email.unsubscribe_link}}">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

export default function Campaigns() {
  const { toast } = useToast();
  
  const { data: articlesData, isLoading: loadingArticles, error: articlesError } = useArticles();
  const { data: tagsData, isLoading: loadingTags, error: tagsError } = useTags();
  const { data: campaignsData, isLoading: loadingCampaigns, error: campaignsError } = useCampaigns();
  
  const audiencePreview = useAudiencePreview();
  const saveCampaign = useSaveCampaign();
  const testCampaign = useTestCampaign();
  const scheduleCampaign = useScheduleCampaign();
  const resolveUncertain = useResolveUncertainCampaign();
  const campaignStats = useCampaignStats();

  const [activeTab, setActiveTab] = useState<"compose" | "history">("compose");
  
  // Form State
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [fromName, setFromName] = useState("Your business");
  const [fromEmail, setFromEmail] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("tags");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [excludedTags, setExcludedTags] = useState<Set<string>>(new Set());
  
  // Created draft state
  const [draftCampaign, setDraftCampaign] = useState<Campaign | null>(null);
  const [loadedCampaignStats, setLoadedCampaignStats] = useState<Record<number, CampaignStats>>({});
  const [statsErrorCampaignId, setStatsErrorCampaignId] = useState<number | null>(null);
  
  // Dialogs
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  
  const [uncertainCampaign, setUncertainCampaign] = useState<Campaign | null>(null);

  const articles = articlesData?.articles ?? [];
  const tags = tagsData?.tags ?? [];
  const campaigns = campaignsData?.campaigns ?? [];
  const selectedTagNames = tags.filter((tag) => selectedTags.has(tag.id)).map((tag) => tag.name);
  const excludedTagNames = tags.filter((tag) => excludedTags.has(tag.id)).map((tag) => tag.name);
  const knownTagIds = new Set(tags.map((tag) => tag.id));
  const overlappingTagIds = [...selectedTags].filter((id) => excludedTags.has(id));
  const unavailableTagCount =
    (audienceMode === "tags" ? [...selectedTags].filter((id) => !knownTagIds.has(id)).length : 0)
    + [...excludedTags].filter((id) => !knownTagIds.has(id)).length;
  const audienceReady =
    (audienceMode === "all" || selectedTags.size > 0 || excludedTags.size > 0)
    && overlappingTagIds.length === 0
    && unavailableTagCount === 0;
  const sameTagSet = (left: Set<string>, right: string[] | undefined) =>
    left.size === (right?.length ?? 0) && (right ?? []).every((id) => left.has(id));
  const effectiveSelectedTags = audienceMode === "all" ? new Set<string>() : selectedTags;
  const savedAudienceMatches = !!draftCampaign
    && audienceMode === (draftCampaign.audience_mode ?? "tags")
    && sameTagSet(effectiveSelectedTags, draftCampaign.tag_ids)
    && sameTagSet(excludedTags, draftCampaign.excluded_tag_ids);
  const startsWithAllContacts = audienceMode === "all" || (audienceMode === "tags" && selectedTags.size === 0);
  const audienceSummary = startsWithAllContacts
    ? `All eligible HighLevel contacts${excludedTagNames.length ? `, excluding ${excludedTagNames.join(", ")}` : ""}`
    : `${selectedTagNames.length} included tag${selectedTagNames.length === 1 ? "" : "s"}${excludedTagNames.length ? `, excluding ${excludedTagNames.join(", ")}` : ""}`;

  // Reset form when article is selected
  const handleSelectArticle = (article: Article) => {
    setSelectedArticle(article);
    setCampaignName(article.title.slice(0, 50) + " Broadcast");
    setSubject(article.title);
    setPreheader(article.excerpt.slice(0, 100));
    setHtmlContent(buildBrandedHtml(article));
    setDraftCampaign(null); // New article means new campaign
  };

  const handleResumeDraft = (campaign: Campaign) => {
    const article = articles.find((item) => item.id === campaign.article_id);
    if (!article || !campaign.html_content) {
      toast({ title: "Draft cannot be opened", description: "Its article is no longer available in the Knowledge Centre feed.", variant: "destructive" });
      return;
    }
    setSelectedArticle(article);
    setCampaignName(campaign.title);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader ?? "");
    setFromName(campaign.from_name);
    setFromEmail(campaign.from_email);
    setAudienceMode(campaign.audience_mode ?? "tags");
    setSelectedTags(new Set(campaign.tag_ids ?? []));
    setExcludedTags(new Set(campaign.excluded_tag_ids ?? []));
    audiencePreview.reset();
    setHtmlContent(campaign.html_content);
    setDraftCampaign(campaign);
    setActiveTab("compose");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggleTag = (tagId: string) => {
    const next = new Set(selectedTags);
    if (next.has(tagId)) next.delete(tagId);
    else {
      if (excludedTags.has(tagId)) {
        toast({ title: "Tag is already excluded", description: "Remove it from the exclusion list before including it.", variant: "destructive" });
        return;
      }
      next.add(tagId);
    }
    setSelectedTags(next);
    audiencePreview.reset();
  };

  const handleToggleExcludedTag = (tagId: string) => {
    const next = new Set(excludedTags);
    if (next.has(tagId)) next.delete(tagId);
    else {
      if (selectedTags.has(tagId) && audienceMode === "tags") {
        toast({ title: "Tag is already included", description: "Remove it from the included list before excluding it.", variant: "destructive" });
        return;
      }
      if (selectedTags.has(tagId)) {
        const nextSelected = new Set(selectedTags);
        nextSelected.delete(tagId);
        setSelectedTags(nextSelected);
      }
      next.add(tagId);
    }
    setExcludedTags(next);
    audiencePreview.reset();
  };

  const handleAudienceModeChange = (mode: AudienceMode) => {
    setAudienceMode(mode);
    audiencePreview.reset();
  };

  const handlePreviewAudience = () => {
    if (audienceMode === "tags" && selectedTags.size === 0 && excludedTags.size === 0) {
      toast({ title: "Select an included or excluded tag first", variant: "destructive" });
      return;
    }
    audiencePreview.mutate({
      mode: audienceMode,
      tagIds: audienceMode === "tags" ? Array.from(selectedTags) : [],
      excludedTagIds: Array.from(excludedTags),
    });
  };

  const handleSaveDraft = () => {
    if (!selectedArticle) return;
    saveCampaign.mutate({
      id: draftCampaign?.id,
      articleId: selectedArticle.id,
      title: campaignName,
      subject,
      preheader,
      fromName,
      fromEmail,
      mode: audienceMode,
      tagIds: audienceMode === "tags" ? Array.from(selectedTags) : [],
      excludedTagIds: Array.from(excludedTags),
      htmlContent
    }, {
      onSuccess: (res) => {
        setDraftCampaign(res.campaign);
        toast({ title: "Draft saved successfully" });
      },
      onError: (err) => {
        toast({ title: "Failed to save draft", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleTestSend = () => {
    if (!draftCampaign) return;
    testCampaign.mutate({ id: draftCampaign.id, email: testEmail }, {
      onSuccess: () => {
        toast({ title: "Test email sent!", description: "Check your inbox." });
        setTestDialogOpen(false);
      },
      onError: (err) => {
        toast({ title: "Test failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleApproveAndSchedule = () => {
    if (!draftCampaign) return;
    scheduleCampaign.mutate({
      id: draftCampaign.id,
    }, {
      onSuccess: (res) => {
        toast({ title: "Draft approved and scheduled!", description: "It will send next Sunday at 5:00pm UK time." });
        setDraftCampaign(res.campaign);
        setActiveTab("history"); // Move to history tab to see it
      },
      onError: (err) => {
        toast({ title: "Scheduling failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleRefreshStats = (campaignId: number) => {
    setStatsErrorCampaignId(null);
    campaignStats.mutate(campaignId, {
      onSuccess: (result) => {
        setLoadedCampaignStats((current) => ({ ...current, [campaignId]: result.stats }));
      },
      onError: () => {
        setStatsErrorCampaignId(campaignId);
      },
    });
  };

  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (iframeRef.current && viewMode === "preview") {
      iframeRef.current.srcdoc = htmlContent;
    }
  }, [htmlContent, viewMode]);

  return (
    <Layout>
      <div className="flex flex-col h-full bg-slate-50/50 min-h-screen">
        <div className="bg-[#1B2B48] text-white px-4 sm:px-8 py-8 shadow-sm">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-3 mb-2 opacity-80">
              <Megaphone className="w-5 h-5" />
              <span className="text-sm font-semibold tracking-wider uppercase">Production Desk</span>
            </div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Campaigns</h1>
            <p className="text-slate-300 mt-2 max-w-2xl text-sm leading-relaxed">
              Curate content from the Knowledge Centre, assemble branded HTML broadcasts, and batch-schedule them via HighLevel directly to your audience.
            </p>
          </div>
        </div>

        <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-8">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full min-w-0">
            <TabsList className="mb-8 grid h-auto w-full grid-cols-2 bg-white border shadow-sm sm:flex sm:w-fit">
              <TabsTrigger value="compose" className="gap-2 px-2 py-2.5 text-xs sm:px-6 sm:text-sm">
                <Newspaper className="w-4 h-4" /> Compose & Schedule
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2 px-2 py-2.5 text-xs sm:px-6 sm:text-sm">
                <Clock className="w-4 h-4" /> Campaign History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="mt-0 outline-none">
              {!selectedArticle ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">1. Select an Article</h2>
                      <p className="text-sm text-slate-500">Choose a Knowledge Centre article to base your broadcast on.</p>
                    </div>
                  </div>
                  
                  {loadingArticles ? (
                    <div className="flex items-center justify-center py-20 text-slate-400">
                      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading articles...
                    </div>
                  ) : articlesError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" />
                        Knowledge Centre articles could not be loaded
                      </div>
                      <p className="mt-1 text-red-700">{articlesError.message}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {articles.map((article) => (
                        <Card key={article.id} className="overflow-hidden flex flex-col hover:shadow-md transition-shadow border-slate-200 cursor-pointer" onClick={() => handleSelectArticle(article)}>
                          {article.imageUrl ? (
                            <img src={article.imageUrl} alt="" className="w-full h-48 object-cover border-b" />
                          ) : (
                            <div className="w-full h-48 bg-slate-100 flex items-center justify-center border-b">
                              <Newspaper className="w-8 h-8 text-slate-300" />
                            </div>
                          )}
                          <div className="p-5 flex-1 flex flex-col">
                            <h3 className="font-bold text-lg leading-tight mb-2 text-slate-900 line-clamp-2">{article.title}</h3>
                            <p className="text-sm text-slate-500 line-clamp-3 mb-4 flex-1">{article.excerpt}</p>
                            <div className="flex items-center justify-between mt-auto">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                {article.publishedAt ? format(new Date(article.publishedAt), 'MMM d, yyyy') : 'No Date'}
                              </span>
                              <Button variant="secondary" size="sm" className="bg-[#6FA8D3]/10 text-[#6FA8D3] hover:bg-[#6FA8D3]/20">
                                Select <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                      {articles.length === 0 && (
                        <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl text-slate-500">
                          No articles found in the Knowledge Centre.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex min-w-0 flex-col lg:flex-row gap-8 items-start">
                  
                  {/* Left Column: Form Settings */}
                  <div className="w-full min-w-0 lg:w-[45%] flex flex-col gap-6 shrink-0">
                    <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
                      <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedArticle(null)} className="text-slate-500">
                          &larr; Back
                        </Button>
                        <span className="font-semibold text-sm text-slate-800 truncate max-w-[200px]">{selectedArticle.title}</span>
                      </div>
                      <Badge variant="outline" className="bg-slate-50">Drafting</Badge>
                    </div>

                    <Card className="p-6 border-slate-200 shadow-sm space-y-5">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 mb-1">2. Email Setup</h3>
                        <p className="text-sm text-slate-500 mb-4">Configure sender details and subject line.</p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>Internal Campaign Name</Label>
                          <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                        </div>
                        
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>From Name</Label>
                            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>From Email</Label>
                            <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label>Subject Line</Label>
                          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                        </div>
                        
                        <div className="space-y-1.5">
                          <Label>Preheader Text</Label>
                          <Input value={preheader} onChange={(e) => setPreheader(e.target.value)} />
                          <p className="text-xs text-slate-400">Shown as a preview snippet in most email clients.</p>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-6 border-slate-200 shadow-sm space-y-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-slate-800 mb-1">3. Audience & Tags</h3>
                          <p className="text-sm text-slate-500">Choose who is included, then optionally remove contacts carrying selected tags.</p>
                        </div>
                        <Users className="w-5 h-5 text-slate-300" />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleAudienceModeChange("tags")}
                          className={cn(
                            "rounded-xl border p-4 text-left transition-colors",
                            audienceMode === "tags"
                              ? "border-[#6FA8D3] bg-[#6FA8D3]/10 ring-1 ring-[#6FA8D3]/30"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="font-semibold text-slate-800">Selected tags</div>
                          <div className="mt-1 text-xs text-slate-500">Include contacts with at least one selected tag, or leave empty to start with all eligible contacts.</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAudienceModeChange("all")}
                          className={cn(
                            "rounded-xl border p-4 text-left transition-colors",
                            audienceMode === "all"
                              ? "border-[#6FA8D3] bg-[#6FA8D3]/10 ring-1 ring-[#6FA8D3]/30"
                              : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="font-semibold text-slate-800">All contacts</div>
                          <div className="mt-1 text-xs text-slate-500">Start with every eligible contact that has a valid email.</div>
                        </button>
                      </div>

                      {loadingTags ? (
                        <div className="text-sm text-slate-400 flex items-center"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tags...</div>
                      ) : tagsError ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                          <div className="flex items-center gap-2 font-semibold">
                            <AlertTriangle className="h-4 w-4" />
                            HighLevel needs configuring
                          </div>
                          <p className="mt-1 text-amber-800">
                            Add the API key and Location ID under Settings → High Level, with tag, email campaign, and email stats permissions.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {audienceMode === "tags" && (
                            <div className="space-y-2">
                              <div>
                                <Label>Include tags <span className="font-normal text-slate-400">(optional when excluding)</span></Label>
                                <p className="text-xs text-slate-500">A contact only needs one of these tags to be included. Leave empty to include everyone except excluded tags.</p>
                              </div>
                              <div className="max-h-48 overflow-y-auto border rounded-lg p-2 bg-slate-50/50 space-y-1">
                                {tags.map((tag) => (
                                  <label key={tag.id} className="flex items-center gap-3 p-2 hover:bg-slate-100 rounded-md cursor-pointer transition-colors">
                                    <input
                                      type="checkbox"
                                      className="rounded text-[#6FA8D3] focus:ring-[#6FA8D3]"
                                      checked={selectedTags.has(tag.id)}
                                      onChange={() => handleToggleTag(tag.id)}
                                    />
                                    <TagIcon className="w-4 h-4 text-slate-400 shrink-0" />
                                    <span className="text-sm font-medium text-slate-700 flex-1">{tag.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            <div>
                              <Label>Exclude tags <span className="font-normal text-slate-400">(optional)</span></Label>
                              <p className="text-xs text-slate-500">Anyone with one of these tags is removed from the audience.</p>
                            </div>
                            <div className="max-h-48 overflow-y-auto border border-amber-200 rounded-lg p-2 bg-amber-50/40 space-y-1">
                              {tags.map((tag) => (
                                <label key={tag.id} className="flex items-center gap-3 p-2 hover:bg-amber-100/60 rounded-md cursor-pointer transition-colors">
                                  <input
                                    type="checkbox"
                                    className="rounded text-amber-600 focus:ring-amber-500"
                                    checked={excludedTags.has(tag.id)}
                                    onChange={() => handleToggleExcludedTag(tag.id)}
                                  />
                                  <TagIcon className="w-4 h-4 text-amber-500 shrink-0" />
                                  <span className="text-sm font-medium text-slate-700 flex-1">{tag.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                        <span className="font-semibold">Final audience rule:</span> {audienceSummary}.
                      </div>

                      {(overlappingTagIds.length > 0 || unavailableTagCount > 0) && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                          {overlappingTagIds.length > 0
                            ? "A tag cannot be both included and excluded."
                            : `${unavailableTagCount} saved audience tag${unavailableTagCount === 1 ? " is" : "s are"} no longer available in HighLevel.`}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full border-red-200 bg-white text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setSelectedTags(new Set([...selectedTags].filter((id) => knownTagIds.has(id) && !excludedTags.has(id))));
                              setExcludedTags(new Set([...excludedTags].filter((id) => knownTagIds.has(id))));
                              audiencePreview.reset();
                            }}
                          >
                            Remove invalid audience tags
                          </Button>
                        </div>
                      )}

                      <div className="pt-4 border-t flex flex-col gap-3">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={handlePreviewAudience} 
                          disabled={audiencePreview.isPending || !audienceReady}
                          className="w-full"
                        >
                          {audiencePreview.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
                          Calculate Audience Size
                        </Button>

                        {audiencePreview.error && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {audiencePreview.error.message}
                          </div>
                        )}

                        {audiencePreview.data && (
                          <div className={cn(
                            "rounded-lg border p-4",
                            audiencePreview.data.scanIncomplete
                              ? "border-red-200 bg-red-50"
                              : "border-emerald-200 bg-emerald-50",
                          )}>
                            {audiencePreview.data.scanIncomplete ? (
                              <div className="flex items-start gap-2 text-red-800">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                                <div>
                                  <div className="font-bold">HighLevel contact scan was incomplete</div>
                                  <p className="mt-1 text-xs">
                                    The {audiencePreview.data.count} contacts found so far are not the final audience.
                                    Please calculate again; the system will not schedule a campaign from a partial scan.
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 text-emerald-800 font-bold mb-2">
                                  <CheckCircle2 className="w-5 h-5" />
                                  {audiencePreview.data.count} Matching Contacts
                                </div>
                                {audiencePreview.data.contacts.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-semibold text-emerald-700/70 uppercase tracking-wider mb-2">Sample:</p>
                                    {audiencePreview.data.contacts.map((c) => (
                                      <div key={c.id} className="text-xs text-emerald-700 flex justify-between">
                                        <span className="truncate pr-2">{c.name}</span>
                                        <span className="opacity-70 truncate">{c.email}</span>
                                      </div>
                                    ))}
                                    {audiencePreview.data.truncated && (
                                      <div className="text-xs text-emerald-600/60 mt-1 italic">...and {audiencePreview.data.count - audiencePreview.data.contacts.length} more</div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card className="p-6 border-[#6FA8D3]/30 shadow-md bg-[#6FA8D3]/5 space-y-4">
                      <div>
                        <h3 className="text-lg font-bold text-[#1B2B48] mb-1">4. Approve & Schedule</h3>
                        <p className="text-sm text-slate-600">Save the final draft, then approve it to send next Sunday at 5:00pm UK time.</p>
                      </div>

                      <Button 
                        onClick={handleSaveDraft} 
                        disabled={saveCampaign.isPending || !campaignName || !subject || !audienceReady}
                        className="w-full bg-[#1B2B48] hover:bg-[#1B2B48]/90 text-white"
                      >
                        {saveCampaign.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        {draftCampaign ? "Update Draft" : "Save Draft"}
                      </Button>

                      {draftCampaign && (
                        <div className="flex gap-3 pt-2">
                          <Button 
                            variant="outline" 
                            className="flex-1 bg-white border-[#6FA8D3] text-[#6FA8D3] hover:bg-[#6FA8D3]/10"
                            onClick={() => setTestDialogOpen(true)}
                          >
                            <TestTube2 className="w-4 h-4 mr-2" /> Send Test
                          </Button>
                          <Button 
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={handleApproveAndSchedule}
                            disabled={!savedAudienceMatches}
                            title={!savedAudienceMatches ? "Save the latest audience changes before scheduling." : undefined}
                          >
                            {scheduleCampaign.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
                            {scheduleCampaign.isPending ? "Approving..." : "Approve & Schedule"}
                          </Button>
                        </div>
                      )}
                      {draftCampaign && !savedAudienceMatches && (
                        <p className="text-xs font-medium text-amber-700">
                          Save the draft again before scheduling so HighLevel receives the audience rule shown above.
                        </p>
                      )}
                    </Card>
                  </div>

                  {/* Right Column: Live HTML Preview */}
                  <div className="w-full min-w-0 lg:w-[55%] flex flex-col h-[calc(100vh-140px)] lg:sticky lg:top-6">
                    <Card className="flex-1 flex flex-col overflow-hidden border-slate-200 shadow-xl bg-white">
                      <div className="border-b bg-slate-50 px-4 py-3 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold text-sm text-slate-700">Email Content</span>
                        </div>
                        <div className="flex bg-slate-200/50 p-1 rounded-lg">
                          <button
                            onClick={() => setViewMode("preview")}
                            className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors", viewMode === "preview" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700")}
                          >
                            <Eye className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" /> Preview
                          </button>
                          <button
                            onClick={() => setViewMode("code")}
                            className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors", viewMode === "code" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700")}
                          >
                            <Code className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" /> HTML Source
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex-1 relative bg-[#f4f6f8] overflow-hidden">
                        {viewMode === "preview" ? (
                          <iframe 
                            ref={iframeRef}
                            className="absolute inset-0 w-full h-full border-0"
                            title="Email Preview"
                            sandbox="allow-same-origin"
                          />
                        ) : (
                          <Textarea 
                            value={htmlContent}
                            onChange={(e) => setHtmlContent(e.target.value)}
                            className="absolute inset-0 w-full h-full p-4 font-mono text-xs resize-none rounded-none border-0 focus-visible:ring-0 bg-slate-900 text-slate-50"
                            spellCheck={false}
                          />
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 outline-none space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Campaign History</h2>
                  <p className="text-sm text-slate-500">Past broadcasts scheduled through the system.</p>
                </div>
              </div>

              <Card className="border-slate-200 overflow-hidden shadow-sm">
                {loadingCampaigns ? (
                  <div className="p-12 text-center text-slate-400 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading history...
                  </div>
                ) : campaignsError ? (
                  <div className="p-8 text-sm text-red-700">
                    Campaign history could not be loaded: {campaignsError.message}
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    No campaigns have been created yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold tracking-wider">
                        <tr>
                          <th className="px-6 py-4 border-b">Campaign</th>
                          <th className="px-6 py-4 border-b">Status</th>
                          <th className="px-6 py-4 border-b">Audience</th>
                          <th className="px-6 py-4 border-b">Scheduled For</th>
                          <th className="px-6 py-4 border-b">Created</th>
                           <th className="px-6 py-4 border-b">HighLevel Stats</th>
                           <th className="px-6 py-4 border-b text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {campaigns.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-semibold text-slate-800">{c.title}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{c.subject}</div>
                            </td>
                            <td className="px-6 py-4">
                              <Badge className={cn(
                                "capitalize shadow-sm",
                                c.status === "scheduled" && "bg-amber-100 text-amber-800 border-amber-200",
                                (c.status === "processing" || c.status === "created_in_highlevel" || c.status === "handoff_in_progress" || c.status === "handoff_uncertain") && "bg-blue-100 text-blue-800 border-blue-200",
                                c.status === "sent" && "bg-emerald-100 text-emerald-800 border-emerald-200",
                                (c.status === "handoff_failed" || c.status === "failed") && "bg-red-100 text-red-800 border-red-200",
                                c.status === "draft" && "bg-slate-100 text-slate-800 border-slate-200"
                              )} variant="outline">
                                {c.status}
                              </Badge>
                              {c.error_message && <div className="text-[10px] text-red-500 mt-1 max-w-[150px] truncate" title={c.error_message}>{c.error_message}</div>}
                            </td>
                            <td className="px-6 py-4 text-slate-600 font-medium">
                              <div>{c.audience_count ?? '-'}</div>
                              <div className="mt-1 max-w-[220px] text-[11px] font-normal text-slate-400">
                                {c.audience_mode === "all" || (c.audience_mode === "tags" && !c.tag_ids?.length && !!c.excluded_tag_ids?.length)
                                  ? `All contacts${c.excluded_tag_ids?.length ? ` excluding ${c.excluded_tag_ids.length} tag${c.excluded_tag_ids.length === 1 ? "" : "s"}` : ""}`
                                  : `${c.tag_ids?.length ?? 0} included tag${c.tag_ids?.length === 1 ? "" : "s"}${c.excluded_tag_ids?.length ? `, excluding ${c.excluded_tag_ids.length}` : ""}`}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-slate-600">
                              {c.scheduled_at ? format(new Date(c.scheduled_at), 'MMM d, yyyy HH:mm') : '-'}
                            </td>
                            <td className="px-6 py-4 text-slate-500 text-xs">
                              {format(new Date(c.created_at), 'MMM d, yyyy')}
                            </td>
                            <td className="px-6 py-4 align-top min-w-[250px]">
                              {c.high_level_campaign_id ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => handleRefreshStats(c.id)}
                                    disabled={campaignStats.isPending}
                                  >
                                    <RefreshCw className={cn("w-3.5 h-3.5", campaignStats.isPending && "animate-spin")} />
                                    {loadedCampaignStats[c.id] ? "Refresh stats" : "Get stats"}
                                  </Button>
                                  {statsErrorCampaignId === c.id && campaignStats.error && (
                                    <p className="mt-2 max-w-[240px] text-xs text-red-700">{campaignStats.error.message}</p>
                                  )}
                                  {loadedCampaignStats[c.id] && (
                                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                                      <span className="flex justify-between gap-2"><span>Sent</span><strong>{formatStatCount(loadedCampaignStats[c.id].sent)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Delivered</span><strong>{formatStatCount(loadedCampaignStats[c.id].delivered)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Opened</span><strong>{formatStatCount(loadedCampaignStats[c.id].opened)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Open rate</span><strong>{formatStatRate(loadedCampaignStats[c.id].openRate)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Clicked</span><strong>{formatStatCount(loadedCampaignStats[c.id].clicked)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Click rate</span><strong>{formatStatRate(loadedCampaignStats[c.id].clickRate)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Bounced</span><strong>{formatStatCount(
                                        loadedCampaignStats[c.id].permanentFail
                                        + loadedCampaignStats[c.id].temporaryFail
                                        + loadedCampaignStats[c.id].rejected
                                        + loadedCampaignStats[c.id].failed,
                                      )}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Bounce rate</span><strong>{formatStatRate(loadedCampaignStats[c.id].bounceRate)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Unsubscribed</span><strong>{formatStatCount(loadedCampaignStats[c.id].unsubscribed)}</strong></span>
                                      <span className="flex justify-between gap-2"><span>Replied</span><strong>{formatStatCount(loadedCampaignStats[c.id].replied)}</strong></span>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-slate-400">Available after scheduling</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {["draft", "handoff_failed", "created_in_highlevel"].includes(c.status) ? (
                                <Button variant="outline" size="sm" onClick={() => handleResumeDraft(c)}>
                                  Edit draft
                                </Button>
                              ) : c.status === "handoff_uncertain" ? (
                                <Button variant="outline" size="sm" onClick={() => setUncertainCampaign(c)}>
                                  Resolve
                                </Button>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Test Email Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              This sends a live test through the normal email route. It does NOT schedule a bulk send.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input 
                type="email" 
                placeholder="you@example.com" 
                value={testEmail} 
                onChange={(e) => setTestEmail(e.target.value)} 
                autoFocus
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3 rounded-lg flex gap-3 items-start">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>The unsubscribe link is inserted by HighLevel when the campaign is sent. It will not be active in a test email.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleTestSend} disabled={!testEmail || testCampaign.isPending}>
              {testCampaign.isPending ? "Sending..." : "Send Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!uncertainCampaign} onOpenChange={(open) => !open && setUncertainCampaign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve uncertain HighLevel hand-off</DialogTitle>
            <DialogDescription>
              First open this campaign in HighLevel and confirm it is still a draft with no scheduled send. The system will also re-check the live HighLevel status. Only then should you enable another scheduling attempt.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            I have checked HighLevel and confirm this campaign is not scheduled or sending.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUncertainCampaign(null)}>Cancel</Button>
            <Button
              disabled={resolveUncertain.isPending}
              onClick={() => uncertainCampaign && resolveUncertain.mutate(uncertainCampaign.id, {
                onSuccess: () => {
                  toast({ title: "Retry enabled", description: "HighLevel confirmed the campaign is still a draft." });
                  setUncertainCampaign(null);
                },
                onError: (error) => toast({ title: "Could not enable retry", description: error.message, variant: "destructive" }),
              })}
            >
              {resolveUncertain.isPending ? "Checking HighLevel..." : "Confirm and enable retry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}