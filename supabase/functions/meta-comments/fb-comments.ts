// Facebook comment reader for one post. Graph v26 rejects the nested `comments.limit(50){...}` expansion on a Comment
// ("(#100) Tried accessing nonexisting field (comments)"), which made every post of the Sono page fail and its comments
// never reach social_comments. Replies are now read with a separate request per comment that has any (comment_count > 0).
import { mapPool, isPermanentGraphError } from "./pool.ts";
export type Gget = (path: string, params: Record<string, string>) => Promise<{ ok: boolean; data: any; error?: string }>;

export const TOP_FIELDS = "id,message,from{id,name},created_time,permalink_url,comment_count";
export const REPLY_FIELDS = "id,message,from{id,name},created_time,permalink_url";

export type FbThread = { comment: any; replies: any[] };

export async function readFbThreads(gget: Gget, postId: string, token: string, errors: string[], label: string): Promise<{ ok: boolean; threads: FbThread[]; permanent?: boolean }> {
  const r = await gget(`${postId}/comments`, { fields: TOP_FIELDS, filter: "toplevel", order: "reverse_chronological", limit: "50", access_token: token });
  if (!r.ok) { errors.push(`${label} facebook ${postId}: ${r.error}`); return { ok: false, threads: [], permanent: isPermanentGraphError(r.error) }; }
  const tops: any[] = r.data?.data || [];
  // Replies are read with up to 4 requests in flight (they used to be read one after another).
  const replyLists = await mapPool(tops, 4, async (c) => {
    if ((c.comment_count ?? 0) <= 0) return [] as any[];
    const rr = await gget(`${c.id}/comments`, { fields: REPLY_FIELDS, limit: "50", access_token: token });
    if (rr.ok) return rr.data?.data || [];
    errors.push(`${label} facebook replies ${c.id}: ${rr.error}`); // top-level comment is still saved
    return [] as any[];
  });
  return { ok: true, threads: tops.map((comment, i) => ({ comment, replies: replyLists[i] })) };
}
