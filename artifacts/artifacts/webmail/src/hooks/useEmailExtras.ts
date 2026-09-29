import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGetMessageQueryKey, getListMessagesQueryKey } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline?: boolean;
  contentId?: string | null;
}

function withUpn(path: string, upn?: string, extra?: Record<string, string>): string {
  const qs = new URLSearchParams({ ...(upn ? { upn } : {}), ...(extra ?? {}) }).toString();
  return apiUrl(qs ? `${path}?${qs}` : path);
}

/** URL an <img> can load directly (same-origin, session cookie is sent). */
export function attachmentUrl(messageId: string, attachmentId: string, upn?: string, inline = false): string {
  return withUpn(
    `/api/email/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    upn,
    inline ? { inline: "1" } : undefined,
  );
}

export function useAttachments(messageId: string, enabled: boolean, upn?: string) {
  return useQuery<Attachment[]>({
    queryKey: ["attachments", messageId, upn ?? null],
    queryFn: async () => {
      const res = await fetch(withUpn(`/api/email/messages/${encodeURIComponent(messageId)}/attachments`, upn), {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch attachments");
      const data = (await res.json()) as { attachments: Attachment[] };
      return data.attachments;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useToggleFlag(folder?: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { messageId: string; flagged: boolean }>({
    mutationFn: async ({ messageId, flagged }) => {
      const res = await fetch(apiUrl(`/api/email/messages/${messageId}/flag`), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ flagged }),
      });
      if (!res.ok) throw new Error("Failed to update flag");
      return res.json();
    },
    onSuccess: (_data, { messageId }) => {
      qc.invalidateQueries({ queryKey: getGetMessageQueryKey(messageId) });
      if (folder) {
        qc.invalidateQueries({
          queryKey: getListMessagesQueryKey({ folder: folder as "inbox" }),
        });
      }
    },
  });
}

export function downloadAttachment(
  messageId: string,
  attachmentId: string,
  name: string,
  onError: () => void,
  upn?: string,
): void {
  const url = attachmentUrl(messageId, attachmentId, upn);
  fetch(url, { credentials: "include" })
    .then((r) => {
      if (!r.ok) throw new Error("Download failed");
      return r.blob();
    })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      a.click();
      URL.revokeObjectURL(blobUrl);
    })
    .catch(() => onError());
}
