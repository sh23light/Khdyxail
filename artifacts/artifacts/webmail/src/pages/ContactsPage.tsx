import { useState } from "react";
import {
  useListContacts,
  useCreateContact,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Search, Mail, Phone, Building2, Briefcase, Users } from "lucide-react";

const schema = z.object({
  displayName: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ContactsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const params = { top: 100, ...(search ? { search } : {}) };
  const { data, isLoading } = useListContacts(params, {
    query: { queryKey: getListContactsQueryKey(params) },
  });

  const createContact = useCreateContact();
  const contacts = data?.contacts ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: "",
      email: "",
      phone: "",
      company: "",
      jobTitle: "",
    },
  });

  const onSubmit = (values: FormValues) => {
    createContact.mutate(
      {
        data: {
          displayName: values.displayName,
          emailAddresses: [{ address: values.email, name: values.displayName }],
          phone: values.phone || null,
          company: values.company || null,
          jobTitle: values.jobTitle || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Contact created" });
          qc.invalidateQueries({ queryKey: getListContactsQueryKey(params) });
          form.reset();
          setNewOpen(false);
        },
        onError: () => toast({ title: "Failed to create contact", variant: "destructive" }),
      }
    );
  };

  function getInitials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  }

  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-red-500", "bg-indigo-500",
  ];

  function colorFor(name: string) {
    const code = name.charCodeAt(0) + (name.charCodeAt(1) || 0);
    return colors[code % colors.length];
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Contacts</h2>
          {!isLoading && (
            <p className="text-[10px] text-muted-foreground">{contacts.length} contacts</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="h-7 text-xs pl-6 w-48"
              data-testid="input-search-contacts"
            />
          </div>
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setNewOpen(true)} data-testid="button-new-contact">
            <UserPlus className="w-3.5 h-3.5" />
            New Contact
          </Button>
        </div>
      </div>

      {/* Contacts list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                <Skeleton className="w-9 h-9 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
              </div>
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Users className="w-8 h-8 opacity-20" />
            <p className="text-xs">{search ? "No contacts found" : "No contacts yet"}</p>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {contacts.map((contact) => {
              const email = contact.emailAddresses?.[0]?.address || "";
              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-accent/40 transition-colors"
                  data-testid={`card-contact-${contact.id}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ${colorFor(contact.displayName)}`}>
                    {getInitials(contact.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate" data-testid={`text-contact-name-${contact.id}`}>
                      {contact.displayName}
                    </div>
                    {email && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                        <Mail className="w-2.5 h-2.5 shrink-0" />
                        {email}
                      </div>
                    )}
                    {contact.company && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                        <Building2 className="w-2.5 h-2.5 shrink-0" />
                        {contact.company}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Contact Dialog */}
      <Dialog open={newOpen} onOpenChange={(v) => { if (!v) setNewOpen(false); }}>
        <DialogContent className="sm:max-w-md" data-testid="modal-new-contact">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">New Contact</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField control={form.control} name="displayName" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Full Name</FormLabel>
                  <FormControl><Input {...field} className="h-8 text-xs" data-testid="input-contact-name" /></FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Email</FormLabel>
                  <FormControl><Input {...field} type="email" className="h-8 text-xs" data-testid="input-contact-email" /></FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Phone (optional)</FormLabel>
                  <FormControl><Input {...field} className="h-8 text-xs" data-testid="input-contact-phone" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="company" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Company (optional)</FormLabel>
                  <FormControl><Input {...field} className="h-8 text-xs" data-testid="input-contact-company" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="jobTitle" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Job Title (optional)</FormLabel>
                  <FormControl><Input {...field} className="h-8 text-xs" data-testid="input-contact-title" /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setNewOpen(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={createContact.isPending} data-testid="button-save-contact">
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
