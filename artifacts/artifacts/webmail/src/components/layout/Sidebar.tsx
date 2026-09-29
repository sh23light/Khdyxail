import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Send,
  FileText,
  Clock,
  Archive,
  Trash2,
  AlertTriangle,
  MessageSquare,
  Users,
  PenSquare,
  Mail,
  Settings,
  Filter,
  Bot,
  UserCircle,
} from "lucide-react";
import { useGetEmailStats } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import AiProviderModal from "@/components/email/AiProviderModal";
import { useAiProvider, PROVIDER_INFO } from "@/hooks/useAiProvider";
import { apiUrl } from "@/lib/apiBase";

interface SidebarProps {
  onCompose: () => void;
  onClose?: () => void;
}

const navItems = [
  { href: "/inbox", label: "Unified Inbox", icon: Inbox, folder: "inbox" },
  { href: "/outbox", label: "Outbox", icon: Clock, folder: "outbox" },
  { href: "/sent", label: "Sent Items", icon: Send, folder: "sentItems" },
  { href: "/drafts", label: "Drafts", icon: FileText, folder: "drafts" },
  { href: "/archive", label: "Archive", icon: Archive, folder: "archive" },
  { href: "/deleted", label: "Deleted Items", icon: Trash2, folder: "deletedItems" },
  { href: "/junk", label: "Junk", icon: AlertTriangle, folder: "junkemail" },
];

const extraItems = [
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/rules", label: "Rules & Filters", icon: Filter },
];

export default function Sidebar({ onCompose, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { data: stats, error: statsError } = useGetEmailStats();
  const [aiProviderModalOpen, setAiProviderModalOpen] = useState(false);
  const { config: aiConfig, hasConfig: aiConfigured } = useAiProvider();
  const [emails, setEmails] = useState<string[]>([]);

  useEffect(() => { if (statsError) { console.error("[UI] Failed to load email stats:", statsError); } }, [statsError]);

  useEffect(() => {
    fetch(apiUrl("/api/tokens/emails"), { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { emails: string[] }) => setEmails(data.emails ?? []))
      .catch((err) => console.error("[UI] Failed to load personal inboxes:", err));
  }, []);

  const getUnread = (folder: string) => {
    const f = stats?.folders?.find((s) => s.folder === folder);
    return f?.unreadCount ?? 0;
  };

  const isPersonalInboxActive = (email: string) =>
    location === `/inbox/${encodeURIComponent(email)}` || location === `/inbox/${email}`;

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground select-none">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border">
        <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center">
          <Mail className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-sm tracking-wide text-white">Outlook Mail</span>
      </div>

      {/* Compose */}
      <div className="px-3 pt-3 pb-2">
        <Button
          onClick={onCompose}
          className="w-full justify-start gap-2 bg-sidebar-primary hover:bg-sidebar-primary/90 text-white text-sm font-medium h-8"
          data-testid="button-compose"
        >
          <PenSquare className="w-3.5 h-3.5" />
          New Mail
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon, folder }) => {
          const active = location === href || (href === "/inbox" && location === "/");
          const unread = folder ? getUnread(folder) : 0;
          return (
            <Link key={href} href={href}>
              <div
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
                data-testid={`nav-${folder}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {unread > 0 && (
                  <span className="bg-sidebar-primary text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>
            </Link>
          );
        })}

        {emails.length > 0 && (
          <>
            <div className="pt-2 pb-1 px-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                Personal Inboxes
              </div>
            </div>
            {emails.map((email) => (
              <Link key={email} href={`/inbox/${encodeURIComponent(email)}`}>
                <div
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors",
                    isPersonalInboxActive(email)
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                >
                  <UserCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1 truncate">{email}</span>
                </div>
              </Link>
            ))}
          </>
        )}

        <div className="pt-2 pb-1 px-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            More
          </div>
        </div>

        {extraItems.map(({ href, label, icon: Icon }) => {
          const active = location === href;
          return (
            <Link key={href} href={href}>
              <div
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-sidebar-border space-y-1">
        <button
          onClick={() => setAiProviderModalOpen(true)}
          className={cn(
            "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors",
            aiConfigured
              ? "text-purple-400 hover:bg-sidebar-accent/60 hover:text-purple-300"
              : "text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 animate-pulse"
          )}
          title="AI provider settings"
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 text-left truncate">
            {aiConfigured && aiConfig
              ? `${PROVIDER_INFO[aiConfig.provider].label} · ${aiConfig.model}`
              : "Select AI agent"}
          </span>
          <Settings className="w-3 h-3 opacity-50" />
        </button>
        <p className="text-[10px] text-sidebar-foreground/30 px-1">Outlook Webmail</p>
      </div>

      <AiProviderModal
        open={aiProviderModalOpen}
        onClose={() => setAiProviderModalOpen(false)}
      />
    </div>
  );
}
