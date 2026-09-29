import { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import ComposeModal from "@/components/email/ComposeModal";
import { useRuleScheduler } from "@/hooks/useRuleScheduler";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();

  const handleAutoRun = useCallback((ruleName: string, matchCount: number) => {
    if (matchCount > 0) {
      toast({
        title: `Auto-rule ran: ${ruleName}`,
        description: `${matchCount} message${matchCount !== 1 ? "s" : ""} matched and processed.`,
      });
    }
  }, [toast]);

  useRuleScheduler(handleAutoRun);

  const openCompose = () => {
    setComposeOpen(true);
    setSidebarOpen(false);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* ── Top bar with hamburger ── */}
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background z-30">
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Toggle menu"
          aria-label="Toggle navigation menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-foreground/70 tracking-wide select-none">
          Outlook Mail
        </span>
      </div>

      {/* ── Content row ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Backdrop */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/40 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — slides in from the left as an overlay */}
        <div
          className={cn(
            "absolute top-0 left-0 h-full w-52 flex flex-col border-r border-border z-50",
            "transition-transform duration-200 ease-in-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar
            onCompose={openCompose}
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        {/* Main content — always full width */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        mode="compose"
      />
    </div>
  );
}
