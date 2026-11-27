// Run `fn` over `items` with at most `limit` in flight; results keep the input order. Used so one slow Graph call does not
// hold up the other posts (the comment sync of a brand read its posts one after another and took ~50 s).
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// Errors that will not go away by retrying every run (deleted post, no access): the post is marked as read for a while.
// "(#100) Tried accessing nonexisting field (comments)" = the id is an object that has no comments connection (e.g. a Page or a reel id): it never will.
export const isPermanentGraphError = (e: unknown): boolean => /does not exist|Unsupported get request|missing permissions|cannot be loaded|nonexisting field/i.test(String(e ?? ""));
