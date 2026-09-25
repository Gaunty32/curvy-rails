import React, { useMemo, useState, useEffect } from "react";
import { format, subDays, isToday, isAfter, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCallbacks,
  useGetCallbackStats,
  useGetCallbackSettings,
  useUpdateCallbackSettings,
  useRetryCallback,
  getListCallbacksQueryKey,
  getGetCallbackStatsQueryKey,
  getGetCallbackSettingsQueryKey
} from "@workspace/api-client-react";
import { staffAuthHeader } from "@/lib/staff-auth";
import {
  PhoneCall, AlertTriangle, CheckCircle2, Clock, RotateCw, 
  Settings2, Filter, Search, Ban, Calendar, Activity, 
  Globe2, MonitorSmartphone, Power
} from "lucide-react";
import { 
  Card, CardContent, CardDescription, CardHeader, CardTitle 
} from "@/components/ui/card";
import { 
  Tabs, TabsContent, TabsList, TabsTrigger 
} from "@/components/ui/tabs";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import Layout from "@/components/Layout";

type TimeFilter = "today" | "7" | "30";

export default function Callbacks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("today");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const authRequest = { headers: staffAuthHeader() as Record<string, string> };

  // Queries
  const { 
    data: callbacks = [], 
    isLoading: isLoadingCallbacks,
  } = useListCallbacks(
    {
      period: timeFilter,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(sourceFilter === "all" ? {} : { source: sourceFilter }),
    },
    {
      request: authRequest,
      query: { queryKey: [...getListCallbacksQueryKey({
        period: timeFilter,
        ...(statusFilter === "all" ? {} : { status: statusFilter }),
        ...(sourceFilter === "all" ? {} : { source: sourceFilter }),
      })] },
    },
  );

  const { data: stats } = useGetCallbackStats({ request: authRequest });

  const retryMutation = useRetryCallback({ request: authRequest });

  // Derived state for the Queue
  const filteredCallbacks = useMemo(() => {
    const now = new Date();
    return callbacks.filter(cb => {
      const cbDate = parseISO(cb.createdAt);
      
      // Time filter
      if (timeFilter === "today" && !isToday(cbDate)) return false;
      if (timeFilter === "7" && !isAfter(cbDate, subDays(now, 7))) return false;
      if (timeFilter === "30" && !isAfter(cbDate, subDays(now, 30))) return false;

      // Status filter
      if (statusFilter !== "all" && cb.status !== statusFilter) return false;

      // Source filter
      if (sourceFilter !== "all" && cb.source !== sourceFilter) return false;

      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [callbacks, timeFilter, statusFilter, sourceFilter]);

  const uniqueSources = useMemo(() => {
    const sources = new Set<string>();
    callbacks.forEach(cb => { if (cb.source) sources.add(cb.source); });
    return Array.from(sources).sort();
  }, [callbacks]);

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set<string>();
    callbacks.forEach(cb => { if (cb.status) statuses.add(cb.status); });
    return Array.from(statuses).sort();
  }, [callbacks]);

  // Derived metrics from filtered data
  const metrics = useMemo(() => {
    let total = 0;
    let failures = 0;
    let blocked = 0;
    let outOfHours = 0;

    filteredCallbacks.forEach(cb => {
      total++;
      if (cb.status === "highlevel_failed") failures++;
      if (cb.status === "blocked_rate_limit") blocked++;
      if (!cb.businessOpen) outOfHours++;
    });

    return { total, failures, blocked, outOfHours };
  }, [filteredCallbacks]);

  const handleRetry = async (id: string) => {
    try {
      await retryMutation.mutateAsync({ id });
      toast({ title: "Retry successful", description: "The callback was sent to HighLevel." });
      queryClient.invalidateQueries({ queryKey: getListCallbacksQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCallbackStatsQueryKey() });
    } catch (e: any) {
      toast({ 
        title: "Retry failed", 
        description: e.message || "Failed to retry callback", 
        variant: "destructive" 
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent_to_highlevel": return <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">Sent</Badge>;
      case "highlevel_failed": return <Badge variant="destructive">HL Failed</Badge>;
      case "blocked_rate_limit": return <Badge variant="secondary" className="bg-stone-500 text-white hover:bg-stone-600">Blocked</Badge>;
      case "received":
      case "closed_callback_requested": return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Pending</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const extractCampaign = (url?: string | null) => {
    return url || "-";
  };

  return (
    <Layout>
    <div className="flex-1 overflow-y-auto bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
              <PhoneCall className="w-8 h-8 text-primary" />
              Callbacks
            </h1>
            <p className="text-muted-foreground mt-1">
              Monitor callback requests, rescue failed handoffs, and adjust operating hours.
            </p>
          </div>
        </div>

        <Tabs defaultValue="queue" className="w-full">
          <TabsList className="w-full md:w-auto grid grid-cols-2 md:flex bg-muted p-1 rounded-xl">
            <TabsTrigger value="queue" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Activity className="w-4 h-4 mr-2" /> Queue & Metrics
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Settings2 className="w-4 h-4 mr-2" /> Service Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-6 mt-6 outline-none">
            
            {stats && (
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground bg-muted/20 px-4 py-2 rounded-lg border border-border">
                <span className="font-semibold text-foreground">Today:</span>
                <span><strong className="text-foreground">{stats.total || 0}</strong> Total</span>
                <span><strong className="text-foreground">{stats.immediate || 0}</strong> Immediate</span>
                <span><strong className="text-foreground">{stats.closed || 0}</strong> Closed</span>
                <span><strong className="text-foreground">{stats.failures || 0}</strong> Failures</span>
                <span><strong className="text-foreground">{stats.blocked || 0}</strong> Blocked</span>
              </div>
            )}

            {/* Quick Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Requests</CardTitle>
                  <Activity className="w-4 h-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.total}</div>
                  <p className="text-xs text-muted-foreground mt-1">In selected period</p>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Out of Hours</CardTitle>
                  <Clock className="w-4 h-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.outOfHours}</div>
                  <p className="text-xs text-muted-foreground mt-1">Received when closed</p>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Failed Handoffs</CardTitle>
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.failures}</div>
                  <p className="text-xs text-muted-foreground mt-1">Require manual retry</p>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Blocked Spam</CardTitle>
                  <Ban className="w-4 h-4 text-stone-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.blocked}</div>
                  <p className="text-xs text-muted-foreground mt-1">Rate limited or blocked</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters & Table */}
            <Card className="border-border shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filters</span>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={timeFilter} onValueChange={(v: TimeFilter) => setTimeFilter(v)}>
                    <SelectTrigger className="w-[130px] h-9 bg-card">
                      <Calendar className="w-3.5 h-3.5 mr-2 opacity-50" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="7">Last 7 Days</SelectItem>
                      <SelectItem value="30">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px] h-9 bg-card">
                      <Activity className="w-3.5 h-3.5 mr-2 opacity-50" />
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {uniqueStatuses.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[140px] h-9 bg-card">
                      <Globe2 className="w-3.5 h-3.5 mr-2 opacity-50" />
                      <SelectValue placeholder="All Sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      {uniqueSources.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto relative">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Time</TableHead>
                      <TableHead className="whitespace-nowrap">Phone</TableHead>
                      <TableHead className="whitespace-nowrap">Type</TableHead>
                      <TableHead className="whitespace-nowrap">Page</TableHead>
                      <TableHead className="whitespace-nowrap">Campaign</TableHead>
                      <TableHead className="whitespace-nowrap">Source</TableHead>
                       <TableHead className="whitespace-nowrap">Step 1 — Contact</TableHead>
                       <TableHead className="whitespace-nowrap">Step 2 — Workflow</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCallbacks ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                          <RotateCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-50" />
                          Loading queue...
                        </TableCell>
                      </TableRow>
                    ) : filteredCallbacks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                          <PhoneCall className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          No callbacks found matching criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredCallbacks.map((cb) => (
                        <TableRow key={cb.callbackRequestId} className="hover:bg-muted/10 group">
                          <TableCell className="whitespace-nowrap text-sm">
                            <div className="font-medium">{format(parseISO(cb.createdAt), "HH:mm")}</div>
                            <div className="text-xs text-muted-foreground">{format(parseISO(cb.createdAt), "dd MMM")}</div>
                          </TableCell>
                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            {cb.phone}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {cb.callbackType === "scheduled" ? (
                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                              ) : (
                                <Power className="w-3.5 h-3.5 text-emerald-500" />
                              )}
                              <span className="text-sm capitalize">{cb.callbackType || "immediate"}</span>
                            </div>
                            {!cb.businessOpen && <div className="text-[10px] text-amber-600 mt-0.5">Out of hours</div>}
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            {cb.pageUrl ? (
                              <a
                                href={cb.pageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-sm font-medium text-primary hover:underline"
                                title={cb.pageTitle || cb.pageUrl}
                              >
                                {cb.pageTitle || cb.pageUrl}
                              </a>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground max-w-[150px] truncate" title={extractCampaign(cb.utmCampaign)}>
                            {extractCampaign(cb.utmCampaign)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {cb.source}
                          </TableCell>
                           <TableCell className="text-xs min-w-[250px] align-top">
                             <div><strong>HTTP:</strong> {cb.highlevelContactHttpStatus ?? "—"}</div>
                             <div><strong>Successful:</strong> {cb.highlevelContactSucceeded == null ? "—" : cb.highlevelContactSucceeded ? "true" : "false"}</div>
                             <div className="font-mono break-all"><strong>ID:</strong> {cb.highlevelContactId || "—"}</div>
                             {cb.highlevelContactError && <div className="mt-1 text-destructive whitespace-pre-wrap break-words"><strong>Error:</strong> {cb.highlevelContactError}</div>}
                             {cb.highlevelContactResponseBody && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Response body</summary><pre className="mt-1 max-w-[360px] whitespace-pre-wrap break-words text-[10px]">{cb.highlevelContactResponseBody}</pre></details>}
                           </TableCell>
                           <TableCell className="text-xs min-w-[250px] align-top">
                             <div><strong>HTTP:</strong> {cb.highlevelWorkflowHttpStatus ?? "—"}</div>
                             <div><strong>succeeded:</strong> {cb.highlevelWorkflowSucceeded == null ? "—" : cb.highlevelWorkflowSucceeded ? "true" : "false"}</div>
                             <div><strong>Status:</strong> {cb.highlevelWorkflowStatus || "—"}</div>
                             {cb.highlevelWorkflowError && <div className="mt-1 text-destructive whitespace-pre-wrap break-words"><strong>Error:</strong> {cb.highlevelWorkflowError}</div>}
                             {cb.highlevelWorkflowResponseBody && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Response body</summary><pre className="mt-1 max-w-[360px] whitespace-pre-wrap break-words text-[10px]">{cb.highlevelWorkflowResponseBody}</pre></details>}
                           </TableCell>
                           <TableCell className="whitespace-nowrap">
                             {getStatusBadge(cb.status)}
                            {cb.errorMessage && (
                              <div className="text-[10px] text-destructive max-w-[200px] truncate mt-1" title={cb.errorMessage}>
                                {cb.errorMessage}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {cb.status === "highlevel_failed" && (
                              <Button
                                variant="outline" 
                                size="sm"
                                onClick={() => handleRetry(cb.callbackRequestId)}
                                disabled={retryMutation.isPending}
                                className="h-7 text-xs border-primary/20 hover:bg-primary/5 hover:text-primary transition-colors"
                              >
                                {retryMutation.isPending ? <RotateCw className="w-3 h-3 animate-spin mr-1.5" /> : <RotateCw className="w-3 h-3 mr-1.5" />}
                                 Retry Workflow
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-6 outline-none">
            <CallbackSettingsForm />
          </TabsContent>
        </Tabs>

      </div>
    </div>
    </Layout>
  );
}

function CallbackSettingsForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryOpts = { request: { headers: staffAuthHeader() as Record<string, string> } };
  
  const { 
    data: settings, 
    isLoading 
  } = useGetCallbackSettings(queryOpts);
  
  const updateMutation = useUpdateCallbackSettings(queryOpts);
  
  // Local state for edits
  const [hours, setHours] = useState<any>(null);
  const [ipLimit, setIpLimit] = useState(5);
  const [phoneLimit, setPhoneLimit] = useState(3);

  const initRef = React.useRef(false);

  useEffect(() => {
    if (settings && !initRef.current) {
      if (settings.hours) setHours(settings.hours);
      if (settings.ip_limit) setIpLimit(settings.ip_limit);
      if (settings.phone_limit) setPhoneLimit(settings.phone_limit);
      initRef.current = true;
    }
  }, [settings]);

  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  const handleToggleDay = (day: string, active: boolean) => {
    setHours((prev: any) => ({
      ...prev,
      [day]: active ? { open: "10:00", close: "16:00" } : null
    }));
  };

  const handleTimeChange = (day: string, field: "open"|"close", value: string) => {
    setHours((prev: any) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value }
    }));
  };

  const handleSave = async () => {
    if (!hours) return;
    try {
      await updateMutation.mutateAsync({
        data: {
          hours,
          ip_limit: ipLimit,
          phone_limit: phoneLimit
        }
      });
      toast({ title: "Settings saved", description: "Operating hours and limits updated successfully." });
      queryClient.invalidateQueries({ queryKey: getGetCallbackSettingsQueryKey() });
    } catch (e: any) {
      toast({ title: "Failed to save settings", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading || !hours) {
    return (
      <Card className="border-border shadow-sm">
        <CardContent className="h-64 flex flex-col items-center justify-center text-muted-foreground">
          <RotateCw className="w-6 h-6 animate-spin mb-4 opacity-50" />
          Loading settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <Card className="border-border shadow-sm lg:col-span-2">
        <CardHeader className="border-b border-border bg-muted/20">
          <CardTitle className="text-lg">Operating Hours</CardTitle>
          <CardDescription>
            Determine when the widget offers "Immediate Callback" versus "Schedule for later".
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {DAYS.map(day => {
              const isActive = hours[day] !== null;
              return (
                <div key={day} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-4 w-40">
                    <Switch 
                      checked={isActive} 
                      onCheckedChange={(c) => handleToggleDay(day, c)}
                    />
                    <Label className="capitalize font-medium cursor-pointer" onClick={() => handleToggleDay(day, !isActive)}>
                      {day}
                    </Label>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    {isActive ? (
                      <>
                        <Input 
                          type="time" 
                          className="w-[130px] font-mono text-sm h-9" 
                          value={hours[day]?.open || "10:00"}
                          onChange={(e) => handleTimeChange(day, "open", e.target.value)}
                        />
                        <span className="text-muted-foreground text-sm font-medium">to</span>
                        <Input 
                          type="time" 
                          className="w-[130px] font-mono text-sm h-9" 
                          value={hours[day]?.close || "17:00"}
                          onChange={(e) => handleTimeChange(day, "close", e.target.value)}
                        />
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground italic w-[287px] text-right">Closed all day</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="border-border shadow-sm">
          <CardHeader className="border-b border-border bg-muted/20">
            <CardTitle className="text-lg">Rate Limits</CardTitle>
            <CardDescription>
              Prevent repeated calls without adding friction for genuine customers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Max requests per IP</Label>
              <div className="flex items-center gap-3">
                <Input 
                  type="number" 
                  min={1} 
                  max={100} 
                  className="w-24 font-mono" 
                  value={ipLimit}
                  onChange={e => setIpLimit(parseInt(e.target.value) || 1)}
                />
                <span className="text-sm text-muted-foreground">/ 10 minutes</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Max requests per Phone Number</Label>
              <div className="flex items-center gap-3">
                <Input 
                  type="number" 
                  min={1} 
                  max={100} 
                  className="w-24 font-mono" 
                  value={phoneLimit}
                  onChange={e => setPhoneLimit(parseInt(e.target.value) || 1)}
                />
                <span className="text-sm text-muted-foreground">/ 30 minutes</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button 
          onClick={handleSave} 
          disabled={updateMutation.isPending}
          className="w-full h-11 text-base shadow-sm"
        >
          {updateMutation.isPending ? (
            <><RotateCw className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-2" /> Save Settings</>
          )}
        </Button>
      </div>

    </div>
  );
}
