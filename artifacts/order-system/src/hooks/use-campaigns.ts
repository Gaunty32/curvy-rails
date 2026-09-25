import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { staffAuthHeader } from "@/lib/staff-auth";

const API_BASE = "/api/campaigns";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeader(),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type Article = {
  id: string;
  title: string;
  link: string;
  excerpt: string;
  content: string;
  imageUrl?: string;
  publishedAt: string;
  author?: string;
};

export type Tag = { id: string; name: string; count?: number };
export type ContactPreview = { id: string; name: string; email: string; tags: string[] };
export type AudiencePreview = {
  count: number;
  contacts: ContactPreview[];
  scanIncomplete: boolean;
  truncated: boolean;
};
export type AudienceMode = "tags" | "all";
export type AudienceRule = { mode: AudienceMode; tagIds: string[]; excludedTagIds: string[] };
export type CampaignStats = {
  sent: number;
  accepted: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  complained: number;
  permanentFail: number;
  temporaryFail: number;
  rejected: number;
  failed: number;
  replied: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  complaintRate: number;
  bounceRate: number;
  replyRate: number;
};

export type Campaign = {
  id: number;
  article_id: string;
  title: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  audience_mode: AudienceMode;
  tag_ids: string[];
  excluded_tag_ids: string[];
  status: "draft" | "handoff_in_progress" | "handoff_uncertain" | "created_in_highlevel" | "handoff_failed" | "scheduled" | "processing" | "sent" | "failed";
  audience_count?: number;
  scheduled_at?: string;
  high_level_campaign_id?: string;
  high_level_source_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  html_content?: string;
};

export function useArticles() {
  return useQuery<{ articles: Article[] }>({
    queryKey: ["campaigns", "articles"],
    queryFn: () => apiFetch("/articles"),
    staleTime: 5 * 60_1000,
  });
}

export function useTags() {
  return useQuery<{ tags: Tag[] }>({
    queryKey: ["campaigns", "tags"],
    queryFn: () => apiFetch("/tags"),
    staleTime: 5 * 60_1000,
  });
}

export function useAudiencePreview() {
  return useMutation<AudiencePreview, Error, AudienceRule>({
    mutationFn: (rule) =>
      apiFetch("/audience-preview", {
        method: "POST",
        body: JSON.stringify(rule),
      }),
  });
}

export function useCampaigns() {
  return useQuery<{ campaigns: Campaign[] }>({
    queryKey: ["campaigns", "list"],
    queryFn: () => apiFetch(""),
  });
}

export type SaveCampaignPayload = {
  id?: number;
  articleId: string;
  title: string;
  subject: string;
  preheader: string;
  fromName: string;
  fromEmail: string;
  mode: AudienceMode;
  tagIds: string[];
  excludedTagIds: string[];
  htmlContent: string;
};

export function useSaveCampaign() {
  const qc = useQueryClient();
  return useMutation<{ campaign: Campaign }, Error, SaveCampaignPayload>({
    mutationFn: ({ id, ...data }) =>
      apiFetch(id ? `/${id}` : "", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "list"] });
    },
  });
}

export function useTestCampaign() {
  return useMutation<void, Error, { id: number; email: string }>({
    mutationFn: ({ id, email }) =>
      apiFetch(`/${id}/test`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });
}

export function useCampaignStats() {
  return useMutation<{ stats: CampaignStats }, Error, number>({
    mutationFn: (id) => apiFetch(`/${id}/stats`),
  });
}

export function useScheduleCampaign() {
  const qc = useQueryClient();
  return useMutation<
    { campaign: Campaign },
    Error,
    { id: number }
  >({
    mutationFn: ({ id }) =>
      apiFetch(`/${id}/schedule`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "list"] });
    },
  });
}

export function useResolveUncertainCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ campaign: Campaign }>(`/${id}/resolve-uncertain`, {
      method: "POST",
      body: JSON.stringify({ confirmedNotScheduled: true }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "list"] }),
  });
}
