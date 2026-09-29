import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSendEmail, useReplyToMessage, useForwardMessage, getListMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Send, X, Loader2 } from "lucide-react";

const schema = z.object({
  to: z.string().min(1, "To is required"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  importance: z.enum(["low", "normal", "high"]).default("normal"),
});

type FormValues = z.infer<typeof schema>;

function parseEmails(raw: string) {
  return raw
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((address) => ({ address, name: null }));
}

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  mode: "compose" | "reply" | "forward";
  messageId?: string;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
}

export default function ComposeModal({
  open,
  onClose,
  mode,
  messageId,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
}: ComposeModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const sendEmail = useSendEmail();
  const replyToMessage = useReplyToMessage();
  const forwardMessage = useForwardMessage();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      to: defaultTo,
      cc: "",
      bcc: "",
      subject: defaultSubject,
      body: defaultBody,
      importance: "normal",
    },
  });

  const isPending = sendEmail.isPending || replyToMessage.isPending || forwardMessage.isPending;

  const onSubmit = (values: FormValues) => {
    const toRecipients = parseEmails(values.to);
    const ccRecipients = parseEmails(values.cc ?? "");

    if (mode === "reply" && messageId) {
      replyToMessage.mutate(
        {
          id: messageId,
          data: { body: values.body, toRecipients },
        },
        {
          onSuccess: () => {
            toast({ title: "Reply sent", description: values.subject || defaultSubject || undefined });
            qc.invalidateQueries({ queryKey: getListMessagesQueryKey({ folder: "sentItems" }) });
            form.reset();
            onClose();
          },
          onError: (err) => toast({ title: "Failed to send reply", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
        }
      );
    } else if (mode === "forward" && messageId) {
      forwardMessage.mutate(
        {
          id: messageId,
          data: { body: values.body, toRecipients },
        },
        {
          onSuccess: () => {
            toast({ title: "Message forwarded", description: values.subject || defaultSubject || undefined });
            qc.invalidateQueries({ queryKey: getListMessagesQueryKey({ folder: "sentItems" }) });
            form.reset();
            onClose();
          },
          onError: (err) => toast({ title: "Failed to forward", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
        }
      );
    } else {
      sendEmail.mutate(
        {
          data: {
            subject: values.subject,
            body: values.body,
            toRecipients,
            ccRecipients,
            bccRecipients: parseEmails(values.bcc ?? ""),
            importance: values.importance,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Email sent", description: values.subject || undefined });
            qc.invalidateQueries({ queryKey: getListMessagesQueryKey({ folder: "sentItems" }) });
            form.reset();
            onClose();
          },
          onError: (err) => toast({ title: "Failed to send email", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
        }
      );
    }
  };

  const titleMap = { compose: "New Mail", reply: "Reply", forward: "Forward" };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" data-testid="modal-compose">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{titleMap[mode]}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3 flex-1 overflow-hidden">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
              <label className="text-xs text-muted-foreground text-right">To</label>
              <FormField
                control={form.control}
                name="to"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="recipient@example.com"
                        className="h-7 text-xs"
                        data-testid="input-to"
                      />
                    </FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )}
              />

              {mode === "compose" && (
                <>
                  <label className="text-xs text-muted-foreground text-right">CC</label>
                  <FormField
                    control={form.control}
                    name="cc"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="cc@example.com" className="h-7 text-xs" data-testid="input-cc" />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <label className="text-xs text-muted-foreground text-right">BCC</label>
                  <FormField
                    control={form.control}
                    name="bcc"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="bcc@example.com" className="h-7 text-xs" data-testid="input-bcc" />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <label className="text-xs text-muted-foreground text-right">Subject</label>
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="Subject" className="h-7 text-xs" data-testid="input-subject" />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />

                  <label className="text-xs text-muted-foreground text-right">Priority</label>
                  <FormField
                    control={form.control}
                    name="importance"
                    render={({ field }) => (
                      <FormItem>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-7 text-xs" data-testid="select-importance">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </>
              )}
            </div>

            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Write your message..."
                      className="flex-1 min-h-[200px] text-sm resize-none"
                      data-testid="textarea-body"
                    />
                  </FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                data-testid="button-cancel-compose"
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={isPending} data-testid="button-send">
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                )}
                Send
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
