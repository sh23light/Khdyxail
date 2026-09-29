import { useState, useEffect } from "react";
import {
  useListMessages,
  useMarkMessageRead,
  useDeleteMessage,
  useArchiveMessage,
  useMoveMessage,
  getListMessagesQueryKey,
  getGetEmailStatsQueryKey,
  getGetMessageQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import MessageList from "@/components/email/MessageList";
import ReadingPane from "@/components/email/ReadingPane";
import MailboxAiTab from "@/components/email/MailboxAiTab";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RefreshCw, Search, X, Trash2, Archive, FolderInput,
  Brain, ChevronDown, RotateCcw, ChevronLeft, ChevronRight,
  Mail, MailOpen,
} from "lucide-react";
import type { Message } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useToggleFlag } from "@/hooks/useEmailExtras";

interface FolderPageProps {
  folder: string;
  title: string;
  upn?: string;
}

type FolderParam = "inbox" | "sentItems" | "drafts" | "outbox" | "archive" | "deletedItems" | "junkemail";
type ActiveTab = "messages" | "ai-analysis";

const ALL_FOLDERS = [
  { id: "inbox", label: "Inbox" },
  { id: "sentItems", label: "Sent Items" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
  { id: "deletedItems", label: "Deleted Items" },
  { id: "junkemail", label: "Junk" },
];

const PAGE_SIZE = 25;

type ExtMsg = Message & { isFlagged?: boolean };

export default function FolderPage({ folder, title, upn }: FolderPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>("messages");
  const [selectedMsg, setSelectedMsg] = useState<ExtMsg | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);

  const params = {
    folder: folder as FolderParam,
    top: PAGE_SIZE,
    skip: page * PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(upn ? { upn } : {}),
  } as Parameters<typeof useListMessages>[0];

  const { data, isLoading, refetch, isFetching, error } = useListMessages(params, {
    query: { queryKey: getListMessagesQueryKey(params) },
  });

  const markRead = useMarkMessageRead();
  const deleteMessage = useDeleteMessage();
  const archiveMessage = useArchiveMessage();
  const moveMessage = useMoveMessage();
  const toggleFlag = useToggleFlag(folder);

  const messages = (data?.messages ?? []) as ExtMsg[];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasSelected = !!selectedMsg;
  const isDeleted = folder === "deletedItems";

  useEffect(() => {
    if (error) {
      toast({ title: "Failed to load messages", description: "Check your connection and token status", variant: "destructive" });
    }
  }, [error]);

  useEffect(() => {
    setSelectedMsg(null);
    setSearch("");
    setSearchInput("");
    setActiveTab("messages");
    setPage(0);
  }, [folder]);

  const invalidateList = () => {
    qc.invalidateQueries({ queryKey: getListMessagesQueryKey(params) });
    qc.invalidateQueries({ queryKey: getGetEmailStatsQueryKey() });
  };

  const handleSelect = (msg: ExtMsg) => {
    if (!msg.id) return;
    // Optimistically mark as read in UI immediately — even if the API
    // returns 403 (token only has Mail.Read), the message appears read visually.
    setSelectedMsg({ ...msg, isRead: true });
    setOpenedIds((prev) => new Set([...prev, msg.id!]));
    if (!msg.isRead) {
      markRead.mutate(
        { id: msg.id!, data: { isRead: true } },
        {
          onSuccess: (updated) => {
            setSelectedMsg(updated as ExtMsg);
            invalidateList();
          },
          // On failure (e.g. token lacks Mail.ReadWrite): keep optimistic state silently
        }
      );
    }
  };

  const handleToggleRead = () => {
    if (!selectedMsg) return;
    const nowRead = !selectedMsg.isRead;
    markRead.mutate(
      { id: selectedMsg.id!, data: { isRead: nowRead } },
      {
        onSuccess: (updated) => {
          setSelectedMsg(updated as ExtMsg);
          qc.invalidateQueries({ queryKey: getGetMessageQueryKey(selectedMsg.id) });
          invalidateList();
          // If marking as unread, remove from openedIds so the dot reappears
          if (!nowRead) {
            setOpenedIds((prev) => {
              const next = new Set(prev);
              next.delete(selectedMsg.id!);
              return next;
            });
          }
          toast({ title: nowRead ? "Marked as read" : "Marked as unread" });
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  const handleToggleStar = (msg: ExtMsg) => {
    const flagged = !msg.isFlagged;
    toggleFlag.mutate(
      { messageId: msg.id, flagged },
      {
        onSuccess: () => {
          invalidateList();
          qc.invalidateQueries({ queryKey: getGetMessageQueryKey(msg.id) });
          toast({ title: flagged ? "Message starred" : "Star removed" });
        },
        onError: () => toast({ title: "Failed to update star", variant: "destructive" }),
      }
    );
  };

  const handleDelete = () => {
    if (!selectedMsg) return;
    deleteMessage.mutate(
      { id: selectedMsg.id! },
      {
        onSuccess: () => {
          toast({
            title: isDeleted ? "Permanently deleted" : "Message deleted",
            description: selectedMsg.subject ?? undefined,
          });
          setSelectedMsg(null);
          invalidateList();
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  };

  const handleArchive = () => {
    if (!selectedMsg) return;
    archiveMessage.mutate(
      { id: selectedMsg.id! },
      {
        onSuccess: () => {
          toast({ title: "Message archived", description: selectedMsg.subject ?? undefined });
          setSelectedMsg(null);
          invalidateList();
        },
        onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
      }
    );
  };

  const handleMove = (folderId: string) => {
    if (!selectedMsg) return;
    const label = ALL_FOLDERS.find((f) => f.id === folderId)?.label ?? folderId;
    moveMessage.mutate(
      { id: selectedMsg.id!, data: { destinationFolderId: folderId } },
      {
        onSuccess: () => {
          toast({ title: `Moved to ${label}`, description: selectedMsg.subject ?? undefined });
          setSelectedMsg(null);
          invalidateList();
        },
        onError: () => toast({ title: "Failed to move", variant: "destructive" }),
      }
    );
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const clearSearch = () => {
    setSearch("");
    setSearchInput("");
    setPage(0);
  };

  const moveFolders = ALL_FOLDERS.filter((f) => f.id !== folder);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top Header Bar ── */}
      <div className="flex items-center border-b border-border bg-background shrink-0 h-11 px-3 gap-3">
        {/* Tab bar (left) */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setActiveTab("messages")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === "messages"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            data-testid="tab-messages"
          >
            {title}
          </button>
          <button
            onClick={() => setActiveTab("ai-analysis")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === "ai-analysis"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            data-testid="tab-ai-analysis"
          >
            <Brain className="w-3 h-3" />
            AI Analysis
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Mark Read/Unread */}
          <button
            onClick={handleToggleRead}
            disabled={!hasSelected || markRead.isPending}
            title={selectedMsg?.isRead ? "Mark as unread" : "Mark as read"}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              hasSelected
                ? "border-border text-foreground bg-background hover:bg-accent"
                : "border-border text-muted-foreground/40 bg-background cursor-not-allowed"
            )}
            data-testid="header-button-toggle-read"
          >
            {selectedMsg?.isRead
              ? <Mail className="w-3.5 h-3.5" />
              : <MailOpen className="w-3.5 h-3.5" />}
            {selectedMsg?.isRead ? "Mark Unread" : "Mark Read"}
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={!hasSelected || deleteMessage.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              hasSelected
                ? "border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/10"
                : "border-border text-muted-foreground/40 bg-background cursor-not-allowed"
            )}
            data-testid="header-button-delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleted ? "Delete Forever" : "Delete"}
          </button>

          {/* Archive */}
          {!isDeleted && (
            <button
              onClick={handleArchive}
              disabled={!hasSelected || archiveMessage.isPending}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                hasSelected
                  ? "border-border text-foreground bg-background hover:bg-accent"
                  : "border-border text-muted-foreground/40 bg-background cursor-not-allowed"
              )}
              data-testid="header-button-archive"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </button>
          )}

          {/* Recover */}
          {isDeleted && (
            <button
              onClick={() => handleMove("inbox")}
              disabled={!hasSelected || moveMessage.isPending}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                hasSelected
                  ? "border-green-300 text-green-700 bg-green-50 hover:bg-green-100 dark:border-green-800 dark:text-green-400 dark:bg-green-950/30"
                  : "border-border text-muted-foreground/40 bg-background cursor-not-allowed"
              )}
              data-testid="header-button-recover"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Recover
            </button>
          )}

          {/* Move To */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!hasSelected}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                  hasSelected
                    ? "border-border text-foreground bg-background hover:bg-accent"
                    : "border-border text-muted-foreground/40 bg-background cursor-not-allowed"
                )}
                data-testid="header-button-move"
              >
                <FolderInput className="w-3.5 h-3.5" />
                Move To
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs min-w-[160px]">
              {isDeleted && (
                <>
                  <DropdownMenuItem onClick={() => handleMove("inbox")} className="text-green-700 dark:text-green-400 gap-2">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Recover to Inbox
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {moveFolders.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => handleMove(f.id)} className="gap-2">
                  <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* AI Analysis */}
          <button
            onClick={() => setActiveTab("ai-analysis")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              activeTab === "ai-analysis"
                ? "border-primary/30 text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            data-testid="header-button-ai"
          >
            <Brain className="w-3.5 h-3.5" />
            AI Analysis
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="button-refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Content Area ── */}
      {activeTab === "ai-analysis" ? (
        <MailboxAiTab />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Message list panel */}
          <div
            className={cn(
              "flex flex-col border-r border-border overflow-hidden bg-background",
              selectedMsg ? "w-72 shrink-0" : "flex-1"
            )}
          >
            {/* Folder info + search */}
            <div className="px-3 py-2 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-muted-foreground">
                  {isLoading ? "Loading…" : `${total} messages`}
                  {search && (
                    <span className="ml-1 text-primary font-medium">· searching</span>
                  )}
                </p>
                {selectedMsg && (
                  <span className="text-[10px] text-primary font-medium">1 selected</span>
                )}
              </div>
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search… (press Enter)"
                  className="h-7 text-xs pl-6 pr-6"
                  data-testid="input-search"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </form>
            </div>

            <div className="flex-1 overflow-y-auto">
              <MessageList
                messages={messages}
                isLoading={isLoading}
                selectedId={selectedMsg?.id ?? null}
                onSelect={handleSelect}
                onToggleStar={handleToggleStar}
                openedIds={openedIds}
              />
            </div>

            {/* Pagination */}
            {!isLoading && total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-border shrink-0 bg-background">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || isFetching}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
                    page === 0
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <ChevronLeft className="w-3 h-3" />
                  Prev
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore || isFetching}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
                    !hasMore
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  Next
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Reading pane */}
          {selectedMsg ? (
            <ReadingPane
              messageId={selectedMsg.id}
              currentFolder={folder}
              onClose={() => setSelectedMsg(null)}
              onToggleStar={() => handleToggleStar(selectedMsg)}
              onDelete={handleDelete}
              onArchive={!isDeleted ? handleArchive : undefined}
            />
          ) : (
            !isLoading && messages.length > 0 && (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center space-y-2">
                  <div className="text-4xl opacity-10">✉</div>
                  <p className="text-xs">Select a message to read</p>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
