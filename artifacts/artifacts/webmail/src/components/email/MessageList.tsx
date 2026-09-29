import { cn } from "@/lib/utils";
import { Paperclip, AlertCircle, ArrowDown, Star } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Message } from "@workspace/api-client-react";
import { formatDistanceToNow, parseISO } from "date-fns";

type ExtMsg = Message & { isFlagged?: boolean };

interface MessageListProps {
  messages: ExtMsg[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (msg: ExtMsg) => void;
  onToggleStar?: (msg: ExtMsg) => void;
  /** IDs of messages that have been opened this session (treat as read visually) */
  openedIds?: Set<string>;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return "";
  }
}

function ImportanceIcon({ importance }: { importance: string }) {
  if (importance === "high") return <AlertCircle className="w-3 h-3 text-destructive shrink-0" />;
  if (importance === "low") return <ArrowDown className="w-3 h-3 text-muted-foreground shrink-0" />;
  return null;
}

export default function MessageList({ messages, isLoading, selectedId, onSelect, onToggleStar, openedIds }: MessageListProps) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-3 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <div className="text-3xl opacity-20">✉</div>
        <p className="text-xs">No messages</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-y-auto" role="list">
      {messages.map((msg) => {
        const selected = msg.id === selectedId;
        // A message is "effectively read" if the server says so, it's currently
        // selected, or the user opened it this session (optimistic visual state).
        // Server's isRead:false is authoritative — always show the dot when unread,
        // even if the message is currently selected or was opened this session.
        const effectivelyRead = msg.isRead === false
          ? false
          : msg.isRead || selected || !!(msg.id && openedIds?.has(msg.id));
        const dateField = msg.receivedDateTime || msg.sentDateTime;
        const senderName = msg.from?.name || msg.from?.address || "Unknown";
        return (
          <div
            key={msg.id}
            role="listitem"
            onClick={() => onSelect(msg)}
            data-testid={`message-item-${msg.id}`}
            className={cn(
              "px-3 py-2.5 cursor-pointer transition-colors group relative",
              selected
                ? "bg-primary/10 border-l-2 border-l-primary"
                : "hover:bg-accent/50 border-l-2 border-l-transparent",
              !effectivelyRead && "bg-blue-50/60 dark:bg-blue-950/20"
            )}
          >
            {/* Unread dot */}
            {!effectivelyRead && (
              <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-primary rounded-full" />
            )}

            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "text-xs truncate max-w-[120px]",
                  !effectivelyRead ? "font-semibold text-foreground" : "font-medium text-foreground/80"
                )}
                data-testid={`text-sender-${msg.id}`}
              >
                {senderName}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <ImportanceIcon importance={msg.importance} />

                {/* Star button — always visible when starred, visible on hover otherwise */}
                {onToggleStar && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleStar(msg); }}
                    className={cn(
                      "transition-colors rounded",
                      msg.isFlagged
                        ? "text-amber-400"
                        : "text-transparent group-hover:text-muted-foreground hover:!text-amber-400"
                    )}
                    title={msg.isFlagged ? "Remove star" : "Star message"}
                    aria-label={msg.isFlagged ? "Remove star" : "Star message"}
                  >
                    <Star className={cn("w-3 h-3", msg.isFlagged && "fill-amber-400")} />
                  </button>
                )}

                {msg.hasAttachments && <Paperclip className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatDate(dateField)}
                </span>
              </div>
            </div>

            <div
              className={cn(
                "text-xs truncate mt-0.5",
                !effectivelyRead ? "font-medium text-foreground" : "text-foreground/70"
              )}
              data-testid={`text-subject-${msg.id}`}
            >
              {msg.subject || "(no subject)"}
            </div>

            <div className="text-[11px] text-muted-foreground truncate mt-0.5 leading-tight">
              {msg.bodyPreview}
            </div>
          </div>
        );
      })}
    </div>
  );
}
