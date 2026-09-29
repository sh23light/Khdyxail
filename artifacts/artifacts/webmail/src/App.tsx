import { useEffect, useState, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiBase";
import NotFound from "@/pages/not-found";
import MainLayout from "@/components/layout/MainLayout";
import FolderPage from "@/pages/FolderPage";
import ContactsPage from "@/pages/ContactsPage";
import ConversationsPage from "@/pages/ConversationsPage";
import RulesPage from "@/pages/RulesPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

type AuthState =
  | { status: "loading" }
  | { status: "authenticated" }
  | { status: "unauthenticated"; loginPath: string | null; loginUrl: string | null };

function AccessGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const sessionResponse = await fetch(apiUrl("/api/auth/session"), {
          credentials: "include",
          cache: "no-store",
        });
        if (sessionResponse.ok) {
          if (active) setAuth({ status: "authenticated" });
          return;
        }

        const configResponse = await fetch(apiUrl("/api/auth/config"), {
          credentials: "include",
          cache: "no-store",
        });
        const config = (await configResponse.json().catch(() => ({}))) as {
          loginPath?: string | null;
          loginUrl?: string | null;
        };
        if (active) {
          setAuth({
            status: "unauthenticated",
            loginPath: typeof config.loginPath === "string" ? config.loginPath : null,
            loginUrl: typeof config.loginUrl === "string" ? config.loginUrl : null,
          });
        }
      } catch {
        if (active) {
          setAuth({
            status: "unauthenticated",
            loginPath: null,
            loginUrl: null,
          });
        }
      }
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  if (auth.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </main>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-7 text-center shadow-sm">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="text-lg font-semibold">O</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">Webmail access</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Sign in through the authorized account to continue. New account registration is disabled.
            </p>
          </div>
          {auth.loginPath || auth.loginUrl ? (
            <Button asChild className="w-full">
              <a href={auth.loginPath ?? auth.loginUrl ?? "#"}>Continue to sign in</a>
            </Button>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Use your authorized sign-in link to continue.
            </p>
          )}
        </section>
      </main>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <MainLayout>
      <Switch>
        <Route path="/">
          <Redirect to="/inbox" />
        </Route>
        <Route path="/inbox">
          <FolderPage key="unified-inbox" folder="inbox" title="Inbox" />
        </Route>
        <Route path="/inbox/:upn">
          {(params) => {
            // Sidebar links use encodeURIComponent (e.g. live.com#user@outlook.com -> live.com%23...).
            // Decode so the API receives the real mailbox name instead of a double-encoded one.
            let upn = params.upn;
            try { upn = decodeURIComponent(params.upn); } catch { /* already decoded */ }
            // key: switching mailboxes must remount, otherwise the previously selected
            // message (from another mailbox) is re-fetched against the new one and fails.
            return <FolderPage key={upn} folder="inbox" title={`${upn} - Inbox`} upn={upn} />;
          }}
        </Route>
        <Route path="/sent">
          <FolderPage folder="sentItems" title="Sent Items" />
        </Route>
        <Route path="/drafts">
          <FolderPage folder="drafts" title="Drafts" />
        </Route>
        <Route path="/outbox">
          <FolderPage folder="outbox" title="Outbox" />
        </Route>
        <Route path="/archive">
          <FolderPage folder="archive" title="Archive" />
        </Route>
        <Route path="/deleted">
          <FolderPage folder="deletedItems" title="Deleted Items" />
        </Route>
        <Route path="/junk">
          <FolderPage folder="junkemail" title="Junk" />
        </Route>
        <Route path="/conversations">
          <ConversationsPage />
        </Route>
        <Route path="/contacts">
          <ContactsPage />
        </Route>
        <Route path="/rules">
          <RulesPage />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </MainLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AccessGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AccessGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
