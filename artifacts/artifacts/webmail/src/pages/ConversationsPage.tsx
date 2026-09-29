import { useState } from "react";
import { useSearchMessages, useGetConversation, getSearchMessagesQueryKey, getGetConversationQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageSquare, ChevronRight, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Message } from "@workspace/api-client-react";

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  try { return format(parseISO(dateStr), "MMM d, h:mm a"); } catch { return ""; }
}

export default function ConversationsPage() {
  const [query, setQuery] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const searchParams = { q: query || " ", top: 50 };
  const { data: searchData, isLoading: searchLoading } = useSearchMessages(searchParams, {
    query: { queryKey: getSearchMessagesQueryKey(searchParams), enabled: !!query },
  });

  const { data: convData, isLoading: convLoading } = useGetConversation(selectedConvId!, {
    query: {
      queryKey: getGetConversationQueryKey(selectedConvId!),
      enabled: !!selectedConvId,
    },
  });

  const messages = searchData?.messages ?? [];

  // Group messages by conversationId
  const conversations = messages.reduce<Record<string, Message[]>>((acc, msg) => {
    const key = msg.conversationId ?? msg.id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(msg);
    return acc;
  }, {});

  const convEntries = Object.entries(conversations).map(([id, msgs]) => ({
    id,
    subject: msgs[0]?.subject ?? "(no subject)",
    latestDate: msgs[0]?.receivedDateTime ?? msgs[0]?.sentDateTime,
    count: msgs.length,
    firstMsg: msgs[0],
  }));

  const convMessages = convData?.messages ?? [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(inputVal);
    setSelectedConvId(null);
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full bg-background">
      {/* Left panel */}
      <div className={cn("flex flex-col border-r border-border overflow-hidden", selectedConvId ? "w-80 shrink-0" : "flex-1")}>
        <div className="px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold mb-2">Conversation History</h2>
          <form onSubmit={handleSearch} className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Search conversations..."
                className="h-7 text-xs pl-6"
                data-testid="input-search-conversations"
              />
            </div>
            <Button type="submit" size="sm" className="h-7 text-xs px-3" data-testid="button-search-conversations">
              Search
            </Button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {!query && (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-xs">Search to find conversations</p>
            </div>
          )}

          {query && searchLoading && (
            <div className="p-3 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
              ))}
            </div>
          )}

          {query && !searchLoading && convEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <p className="text-xs">No conversations found</p>
            </div>
          )}

          {convEntries.map(({ id, subject, latestDate, count, firstMsg }) => (
            <div
              key={id}
              onClick={() => setSelectedConvId(id === selectedConvId ? null : id)}
              className={cn(
                "px-4 py-3 cursor-pointer transition-colors",
                id === selectedConvId ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent/50 border-l-2 border-l-transparent"
              )}
              data-testid={`conversation-${id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-xs font-medium text-foreground truncate flex-1">{subject}</span>
                <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform shrink-0", id === selectedConvId && "rotate-90")} />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-2.5 h-2.5" />
                  {count} {count === 1 ? "message" : "messages"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {formatDate(latestDate)}
                </span>
              </div>
              {firstMsg?.from?.address && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {firstMsg.from.name || firstMsg.from.address}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Conversation thread */}
      {selectedConvId && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-3 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold">
              {conversations[selectedConvId]?.[0]?.subject ?? "Conversation"}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              {convMessages.length} messages in thread
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {convLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))
            ) : convMessages.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs">No messages in thread</div>
            ) : (
              convMessages.map((msg) => (
                <div key={msg.id} className="border border-border rounded-lg overflow-hidden" data-testid={`thread-message-${msg.id}`}>
                  <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {msg.from?.name || msg.from?.address || "Unknown"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(msg.receivedDateTime || msg.sentDateTime)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      To: {msg.toRecipients?.map((r) => r.address).join(", ")}
                    </div>
                  </div>
                  <div className="px-4 py-3 text-xs text-foreground/80 leading-relaxed">
                    {msg.bodyPreview || "(no preview)"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!selectedConvId && convEntries.length > 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <MessageSquare className="w-8 h-8 opacity-20 mx-auto" />
            <p className="text-xs">Select a conversation to view the thread</p>
          </div>
        </div>
      )}
    </div>
  );
}
