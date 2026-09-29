import { useState, useRef, useCallback } from "react";
import {
  useGetMessage,
  useMarkMessageRead,
  getGetMessageQueryKey,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Reply, Forward, Paperclip, AlertCircle, X,
  Star, Mail, MailOpen, Download, ChevronDown, ChevronUp,
  Trash2, Archive,
} from "lucide-react";
import { format, parseISO, isToday, isThisYear } from "date-fns";
import ComposeModal from "./ComposeModal";
import { useAttachments, downloadAttachment } from "@/hooks/useEmailExtras";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ReadingPaneProps {
  messageId: string;
  currentFolder: string;
  onClose: () => void;
  onToggleStar?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-pink-500",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function initials(name: string | null | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
      : parts[0]!.slice(0, 2).toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = parseISO(dateStr);
    if (isToday(d)) return format(d, "h:mm a");
    if (isThisYear(d)) return format(d, "MMM d, h:mm a");
    return format(d, "MMM d, yyyy h:mm a");
  } catch {
    return "";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼️";
  if (contentType === "application/pdf") return "📄";
  if (contentType.includes("word") || contentType.includes("document")) return "📝";
  if (contentType.includes("spreadsheet") || contentType.includes("excel")) return "📊";
  if (contentType.includes("zip") || contentType.includes("compressed")) return "🗜️";
  return "📎";
}

function processEmailHtml(html: string): string {
  return html
    .replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

// ── Email iframe body ─────────────────────────────────────────────────────────

function EmailIframe({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const handleLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 400;
    setHeight(Math.max(200, h + 32));
  }, []);

  const srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 14px; line-height: 1.6; color: #1f2937;
      padding: 4px 0; word-break: break-word; overflow-x: hidden;
    }
    a { color: #2563eb; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; max-width: 100%; }
    pre { overflow-x: auto; background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 13px; }
    code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
    blockquote { border-left: 3px solid #d1d5db; margin: 8px 0; padding-left: 12px; color: #6b7280; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
    p { margin: 0 0 12px; }
    p:last-child { margin-bottom: 0; }
  </style></head><body>${processEmailHtml(html)}</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", height: `${height}px`, border: "none", display: "block" }}
      onLoad={handleLoad}
      title="Email content"
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReadingPane({
  messageId,
  currentFolder,
  onClose,
  onToggleStar,
  onDelete,
  onArchive,
}: ReadingPaneProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [replyOpen, setReplyOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: msg, isLoading, error } = useGetMessage(messageId, {
    query: { queryKey: getGetMessageQueryKey(messageId) },
  });

  useEffect(() => {
    if (error) {
      toast({ title: "Failed to load message", description: "Could not read email content", variant: "destructive" });
    }
  }, [error]);

  const markRead = useMarkMessageRead();
  const extMsg = msg as typeof msg & { isFlagged?: boolean };

  const { data: attachments, isLoading: attachmentsLoading } = useAttachments(
    messageId,
    !!(msg?.hasAttachments)
  );

  const handleToggleRead = () => {
    if (!msg) return;
    const nowRead = !msg.isRead;
    markRead.mutate(
      { id: messageId, data: { isRead: nowRead } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMessageQueryKey(messageId) });
          qc.invalidateQueries({ queryKey: getListMessagesQueryKey({ folder: currentFolder as "inbox" }) });
          toast({ title: nowRead ? "Marked as read" : "Marked as unread" });
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
          <div className="flex-1" />
          <Skeleton className="h-7 w-7" />
        </div>
        <div className="px-8 pt-7 pb-5 border-b border-border space-y-4">
          <Skeleton className="h-6 w-2/3" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
        </div>
        <div className="flex-1 px-8 pt-6 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (error && !isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-sm">Failed to load message</p>
        <p className="text-xs">Connection or token issue</p>
      </div>
    );
  }

  if (!msg) return null;

  const fromName = msg.from?.name || msg.from?.address || "Unknown";
  const fromEmail = msg.from?.address ?? "";
  const dateField = msg.receivedDateTime || msg.sentDateTime;
  const color = avatarColor(fromEmail || fromName);
  const ini = initials(msg.from?.name, fromEmail);
  const toList = msg.toRecipients?.map((r) => r.name || r.address).join(", ") || "me";
  const ccList = msg.ccRecipients?.map((r) => r.name || r.address).join(", ") ?? "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 bg-background">
        <Button
          variant="outline" size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setReplyOpen(true)}
        >
          <Reply className="w-3.5 h-3.5" /> Reply
        </Button>
        <Button
          variant="outline" size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setForwardOpen(true)}
        >
          <Forward className="w-3.5 h-3.5" /> Forward
        </Button>

        {onDelete && (
          <Button
            variant="ghost" size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        )}

        {onArchive && (
          <Button
            variant="ghost" size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onArchive}
          >
            <Archive className="w-3.5 h-3.5" />
            Archive
          </Button>
        )}

        <div className="flex-1" />

        {/* importance badge */}
        {msg.importance === "high" && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-3 h-3" /> High
          </span>
        )}

        <Button
          variant="ghost" size="sm"
          className={cn(
            "h-8 w-8 p-0",
            extMsg?.isFlagged ? "text-amber-400 hover:text-amber-500" : "text-muted-foreground hover:text-amber-400"
          )}
          onClick={onToggleStar}
          title={extMsg?.isFlagged ? "Remove star" : "Star"}
        >
          <Star className={cn("w-4 h-4", extMsg?.isFlagged && "fill-amber-400")} />
        </Button>

        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          onClick={handleToggleRead}
          title={msg.isRead ? "Mark as unread" : "Mark as read"}
          disabled={markRead.isPending}
        >
          {msg.isRead ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
        </Button>

        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title="Close"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Message header */}
        <div className="px-8 pt-7 pb-5 border-b border-border">
          {/* Subject */}
          <h1 className="text-xl font-semibold text-foreground leading-snug mb-5">
            {msg.subject || "(no subject)"}
          </h1>

          {/* Sender row */}
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0 select-none",
              color
            )}>
              {ini}
            </div>

            {/* Sender info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-foreground">{fromName}</span>
                  {fromEmail && fromName !== fromEmail && (
                    <span className="text-xs text-muted-foreground ml-1.5">&lt;{fromEmail}&gt;</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 font-medium">
                  {formatDate(dateField)}
                </span>
              </div>

              {/* Recipients summary + expand toggle */}
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
              >
                <span>To: {toList.length > 60 ? toList.slice(0, 60) + "…" : toList}</span>
                {detailsOpen
                  ? <ChevronUp className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                  : <ChevronDown className="w-3 h-3 opacity-60 group-hover:opacity-100" />}
              </button>

              {/* Expanded details */}
              {detailsOpen && (
                <div className="mt-2.5 space-y-1 text-xs bg-muted/40 rounded-lg p-3 border border-border/50">
                  <div className="grid grid-cols-[40px_1fr] gap-1">
                    <span className="text-muted-foreground font-medium">From</span>
                    <span>{fromName}{fromEmail ? ` <${fromEmail}>` : ""}</span>

                    <span className="text-muted-foreground font-medium">To</span>
                    <span>{msg.toRecipients?.map((r) => r.name ? `${r.name} <${r.address}>` : r.address).join(", ") || "—"}</span>

                    {ccList && (
                      <>
                        <span className="text-muted-foreground font-medium">CC</span>
                        <span>{msg.ccRecipients?.map((r) => r.name ? `${r.name} <${r.address}>` : r.address).join(", ")}</span>
                      </>
                    )}

                    <span className="text-muted-foreground font-medium">Date</span>
                    <span>{dateField ? format(parseISO(dateField), "EEEE, MMMM d, yyyy h:mm a") : "—"}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Attachments */}
        {msg.hasAttachments && (
          <div className="px-8 py-3 border-b border-border bg-muted/20 shrink-0">
            {attachmentsLoading ? (
              <div className="flex gap-2">
                <Skeleton className="h-9 w-36 rounded-lg" />
                <Skeleton className="h-9 w-28 rounded-lg" />
              </div>
            ) : attachments && attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <button
                    key={att.id}
                    onClick={() => downloadAttachment(messageId, att.id, att.name, () =>
                      toast({ title: "Download failed", variant: "destructive" })
                    )}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors text-xs group"
                    title={`Download ${att.name} (${formatFileSize(att.size)})`}
                  >
                    <span className="text-base leading-none">{fileIcon(att.contentType)}</span>
                    <div className="text-left">
                      <div className="font-medium text-foreground max-w-[140px] truncate">{att.name}</div>
                      <div className="text-muted-foreground text-[10px]">{formatFileSize(att.size)}</div>
                    </div>
                    <Paperclip className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors ml-1" />
                    <Download className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No downloadable attachments</p>
            )}
          </div>
        )}

        {/* Email body */}
        <div className="px-8 py-6">
          {msg.body ? (
            <EmailIframe html={msg.body} />
          ) : msg.bodyPreview ? (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.bodyPreview}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No message content.</p>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="px-8 py-5 border-t border-border bg-muted/10">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline" size="sm"
              className="h-9 gap-2 text-xs"
              onClick={() => setReplyOpen(true)}
            >
              <Reply className="w-4 h-4" /> Reply
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-9 gap-2 text-xs"
              onClick={() => setForwardOpen(true)}
            >
              <Forward className="w-4 h-4" /> Forward
            </Button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ComposeModal
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        mode="reply"
        messageId={messageId}
        defaultTo={msg.from?.address || ""}
        defaultSubject={`Re: ${msg.subject || ""}`}
      />
      <ComposeModal
        open={forwardOpen}
        onClose={() => setForwardOpen(false)}
        mode="forward"
        messageId={messageId}
        defaultSubject={`Fwd: ${msg.subject || ""}`}
        defaultBody={`\n\n--- Forwarded message ---\nFrom: ${msg.from?.address || ""}\nSubject: ${msg.subject || ""}\n\n${msg.bodyPreview || ""}`}
      />
    </div>
  );
}
