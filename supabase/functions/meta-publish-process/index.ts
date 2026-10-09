import "../../../assets/js/publication-text.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta Auto Publisher — Phase 43
//
// بتتنادى كل دقيقة عن طريق pg_cron (net.http_post، هيدر X-Cron-Secret بس —
// مش JWT دashboard ولا مفتاح service_role نفسه، راجع setup.sql قسم ٤٣ بند ٦).
// بتاخد الـjobs المستحقة (pending + scheduled_at <= now())، تكلّم Meta Graph
// API (Facebook Page + Instagram Business — صورة واحدة أو كاروسيل من ٢ لـ ١٠ صور)،
// وتحدّث meta_publish_jobs + content_items بمفتاح service_role.
//
// أمان: مفيش أي Meta access token ولا مفتاح Supabase بيوصل للفرونت إند
// أبدًا — كله Edge Function Secrets. مفيش أي log بيطبع قيمة توكن.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const GRAPH_VERSION = "v26.0";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let googleTokenCache: { token: string; expiresAt: number } | null = null;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleDriveAccessToken(): Promise<string> {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) {
    return googleTokenCache.token;
  }

  const raw = Deno.env.get("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) throw new Error("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY secret is missing");

  let sa: GoogleServiceAccount;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email/private_key");
  }

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    base64UrlJson({ alg: "RS256", typ: "JWT" }) +
    "." +
    base64UrlJson({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    });

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = signingInput + "." + base64Url(new Uint8Array(signature));

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("Google OAuth failed: " + (data.error_description || data.error || res.status));
  }

  const expiresIn = Number(data.expires_in || 3600);
  googleTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };
  return data.access_token;
}

function googleDriveFileId(url: string): string | null {
  const pathMatch = /\/file\/d\/([^/?#]+)/.exec(url);
  if (pathMatch) return pathMatch[1];
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("drive.google.com")) return u.searchParams.get("id");
  } catch {
    // not a URL we understand
  }
  return null;
}

function getServiceRoleKey(): string | null {
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw);
      if (parsed && typeof parsed === "object" && typeof parsed["default"] === "string" && parsed["default"]) {
        return parsed["default"];
      }
    } catch {
      // نتجاهل ونكمل على المفتاح القديم
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// توكن الصفحة لكل برند — Edge Function Secret منفصلة لكل واحدة، صفر تخزين
// في أي جدول. لو حبينا نضيف برند تالت لاحقًا، بس نضيف secret جديدة + سطر هنا.
function pageTokenForBrand(brand: string): string | null {
  if (brand === "sono") return Deno.env.get("META_PAGE_TOKEN_SONO") || null;
  if (brand === "dr_dina") return Deno.env.get("META_PAGE_TOKEN_DR_DINA") || null;
  return null;
}

type BrandConfig = { facebook_page_id: string | null; instagram_business_account_id: string | null };

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, data };
}
async function graphPost(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  const body = new URLSearchParams(params);
  const res = await fetch(url.toString(), { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, data };
}

// بند ٤: لو design_file_url مش رابط تحميل مباشر (زي رابط Google Drive
// viewer العادي)، بنجيب البايتات ونرفعها لـSupabase Storage (bucket عام
// "meta-publish-assets") عشان يبقى عندنا رابط ثابت Meta تقدر تجيبه مباشرة
// (Google Drive share links مش مضمونة تترجع bytes الصورة الخام لـfetch
// خارجي). لو الفشل حصل، الـjob بيفشل برسالة واضحة — مفيش تخمين.
async function rehostImageToStorage(admin: ReturnType<typeof createClient>, jobId: string, sourceUrl: string, suffix = "", allowVideo = false): Promise<string> {
  const driveId = googleDriveFileId(sourceUrl);

  let res: Response;
  if (driveId) {
    const googleAccessToken = await getGoogleDriveAccessToken();
    res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );
  } else {
    const source = new URL(sourceUrl);
    const privateMatch = /^\/storage\/v1\/object\/authenticated\/(content-designs|video-inputs)\/(.+)$/.exec(source.pathname);
    if (source.origin === new URL(Deno.env.get("SUPABASE_URL")!).origin && privateMatch) {
      const file = await admin.storage.from(privateMatch[1]).download(decodeURIComponent(privateMatch[2]));
      if (file.error || !file.data) throw new Error("تعذّر تحميل التصميم من التخزين");
      res = new Response(file.data, { headers: { "content-type": file.data.type } });
    } else {
      res = await fetch(sourceUrl);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `تعذّر تحميل ملف التصميم${driveId ? " من Google Drive بحساب الخدمة" : ""} (HTTP ${res.status})` +
      (body ? `: ${body.slice(0, 180)}` : "")
    );
  }

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\//.test(contentType) && !(allowVideo && /^video\//.test(contentType))) {
    throw new Error("ملف التصميم مش " + (allowVideo ? "صورة أو فيديو" : "صورة") + " (content-type: " + (contentType || "unknown") + ")");
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const extByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov"
  };
  const ext = extByType[contentType] || contentType.split("/")[1] || "jpg";
  const path = `${jobId}${suffix}.${ext}`;

  const up = await admin.storage
    .from("meta-publish-assets")
    .upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw new Error("فشل رفع الصورة لـSupabase Storage: " + up.error.message);

  return admin.storage.from("meta-publish-assets").getPublicUrl(path).data.publicUrl;
}

async function publishFacebookPhoto(pageId: string, token: string, imageUrl: string, message: string) {
  const r = await graphPost(`${pageId}/photos`, { url: imageUrl, caption: message, access_token: token });
  if (!r.ok) return { ok: false, error: r.data.error?.message || "فشل نشر الصورة على فيسبوك" };
  const postId: string = r.data.post_id || r.data.id;
  const perma = await graphGet(postId, { fields: "permalink_url", access_token: token });
  return { ok: true, postId, permalink: perma.ok ? perma.data.permalink_url : `https://www.facebook.com/${postId}` };
}
async function publishFacebookTextOnly(pageId: string, token: string, message: string) {
  const r = await graphPost(`${pageId}/feed`, { message, access_token: token });
  if (!r.ok) return { ok: false, error: r.data.error?.message || "فشل نشر المنشور النصي على فيسبوك" };
  const postId: string = r.data.id;
  const perma = await graphGet(postId, { fields: "permalink_url", access_token: token });
  return { ok: true, postId, permalink: perma.ok ? perma.data.permalink_url : `https://www.facebook.com/${postId}` };
}

async function publishInstagramSingleImage(igUserId: string, token: string, imageUrl: string, caption: string) {
  const create = await graphPost(`${igUserId}/media`, { image_url: imageUrl, caption, access_token: token });
  if (!create.ok) return { ok: false, error: create.data.error?.message || "فشل إنشاء container انستجرام" };
  const containerId: string = create.data.id;

  // بند ٦: استنى الـcontainer يخلص معالجة (FINISHED) — لحد ٢٠ ثانية بس عشان
  // ميضربش timeout بتاع الـEdge Function، بفحص كل ٢ ثانية.
  var status = "IN_PROGRESS";
  for (var i = 0; i < 10 && status === "IN_PROGRESS"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const chk = await graphGet(containerId, { fields: "status_code", access_token: token });
    status = chk.ok ? chk.data.status_code : "ERROR";
  }
  if (status !== "FINISHED") return { ok: false, containerId, error: "container انستجرام ماخلصش معالجة (status: " + status + ")" };

  const pub = await graphPost(`${igUserId}/media_publish`, { creation_id: containerId, access_token: token });
  if (!pub.ok) return { ok: false, containerId, error: pub.data.error?.message || "فشل نشر container انستجرام" };
  const mediaId: string = pub.data.id;
  const perma = await graphGet(mediaId, { fields: "permalink", access_token: token });
  return { ok: true, containerId, mediaId, permalink: perma.ok ? perma.data.permalink : null };
}

// كاروسيل فيسبوك: كل صورة بتترفع "مش منشورة" وبعدين بوست واحد بيجمعهم.
async function publishFacebookCarousel(pageId: string, token: string, imageUrls: string[], message: string) {
  const ids: string[] = [];
  for (const url of imageUrls) {
    const r = await graphPost(`${pageId}/photos`, { url, published: "false", access_token: token });
    if (!r.ok) return { ok: false, error: r.data.error?.message || "فشل رفع صورة من صور الكاروسيل على فيسبوك" };
    ids.push(r.data.id);
  }
  const params: Record<string, string> = { message, access_token: token };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const r = await graphPost(`${pageId}/feed`, params);
  if (!r.ok) return { ok: false, error: r.data.error?.message || "فشل نشر كاروسيل فيسبوك" };
  const postId: string = r.data.id;
  const perma = await graphGet(postId, { fields: "permalink_url", access_token: token });
  return { ok: true, postId, permalink: perma.ok ? perma.data.permalink_url : `https://www.facebook.com/${postId}` };
}

async function waitInstagramContainers(ids: string[], token: string, maxSeconds: number): Promise<string | null> {
  const pending = new Set(ids);
  for (let waited = 0; waited < maxSeconds && pending.size; waited += 2) {
    await new Promise((r) => setTimeout(r, 2000));
    for (const id of [...pending]) {
      const chk = await graphGet(id, { fields: "status_code", access_token: token });
      const code = chk.ok ? chk.data.status_code : "ERROR";
      if (code === "FINISHED") pending.delete(id);
      else if (code === "ERROR" || code === "EXPIRED") return code;
    }
  }
  return pending.size ? "IN_PROGRESS" : null;
}

// كاروسيل انستجرام: container لكل صورة (is_carousel_item) ثم container أب CAROUSEL.
async function publishInstagramCarousel(igUserId: string, token: string, imageUrls: string[], caption: string) {
  const children: string[] = [];
  for (const url of imageUrls) {
    const c = await graphPost(`${igUserId}/media`, { image_url: url, is_carousel_item: "true", access_token: token });
    if (!c.ok) return { ok: false, error: c.data.error?.message || "فشل إنشاء صورة من صور كاروسيل انستجرام" };
    children.push(c.data.id);
  }
  const childStatus = await waitInstagramContainers(children, token, 30);
  if (childStatus) return { ok: false, error: "صور الكاروسيل ماخلصتش معالجة على انستجرام (status: " + childStatus + ")" };
  const parent = await graphPost(`${igUserId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token });
  if (!parent.ok) return { ok: false, error: parent.data.error?.message || "فشل إنشاء container كاروسيل انستجرام" };
  const containerId: string = parent.data.id;
  const parentStatus = await waitInstagramContainers([containerId], token, 20);
  if (parentStatus) return { ok: false, containerId, error: "container الكاروسيل ماخلصش معالجة (status: " + parentStatus + ")" };
  const pub = await graphPost(`${igUserId}/media_publish`, { creation_id: containerId, access_token: token });
  if (!pub.ok) return { ok: false, containerId, error: pub.data.error?.message || "فشل نشر كاروسيل انستجرام" };
  const mediaId: string = pub.data.id;
  const perma = await graphGet(mediaId, { fields: "permalink", access_token: token });
  return { ok: true, containerId, mediaId, permalink: perma.ok ? perma.data.permalink : null };
}

// فيديو فيسبوك: Meta بتحمّل الفيديو من الرابط وتعالجه في الخلفية.
async function publishFacebookVideo(pageId: string, token: string, videoUrl: string, message: string) {
  const r = await graphPost(`${pageId}/videos`, { file_url: videoUrl, description: message, access_token: token });
  if (!r.ok) return { ok: false, error: r.data.error?.message || "فشل نشر الفيديو على فيسبوك" };
  const videoId: string = r.data.id;
  const perma = await graphGet(videoId, { fields: "permalink_url", access_token: token });
  const link = perma.ok && perma.data.permalink_url ? perma.data.permalink_url : `/${videoId}`;
  return { ok: true, postId: videoId, permalink: link.startsWith("http") ? link : `https://www.facebook.com${link}` };
}

// ريلز انستجرام: معالجة الفيديو ممكن تاخد دقايق، فبنستنى لحد ~٩٠ ثانية بس.
// لو لسه بيتعالج، بنرجّع pending ونحتفظ بالـcontainer، والتشغيلة الجاية تكمّل
// النشر من غير ما تعيد رفع الفيديو.
async function publishInstagramReel(igUserId: string, token: string, videoUrl: string, caption: string, existingContainer: string | null) {
  let containerId = existingContainer;
  if (!containerId) {
    const c = await graphPost(`${igUserId}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: token });
    if (!c.ok) return { ok: false, error: c.data.error?.message || "فشل إنشاء ريل انستجرام" };
    containerId = c.data.id;
  }
  const status = await waitInstagramContainers([containerId as string], token, 90);
  if (status === "IN_PROGRESS") return { ok: false, pending: true, containerId, error: "الريل لسه بيتعالج على انستجرام" };
  if (status) return { ok: false, containerId, error: "ريل انستجرام فشل في المعالجة (status: " + status + ")" };
  const pub = await graphPost(`${igUserId}/media_publish`, { creation_id: containerId as string, access_token: token });
  if (!pub.ok) return { ok: false, containerId, error: pub.data.error?.message || "فشل نشر ريل انستجرام" };
  const mediaId: string = pub.data.id;
  const perma = await graphGet(mediaId, { fields: "permalink", access_token: token });
  return { ok: true, containerId, mediaId, permalink: perma.ok ? perma.data.permalink : null };
}

function carouselSlideUrls(contentId: string, slides: unknown): string[] {
  if (!Array.isArray(slides)) return [];
  const prefix = new URL(SUPABASE_URL).origin + "/storage/v1/object/authenticated/content-designs/" + contentId + "/";
  return slides.filter((u): u is string => typeof u === "string" && u.startsWith(prefix) && u.endsWith("/output.png")).slice(0, 10);
}

async function processJob(admin: ReturnType<typeof createClient>, job: any) {
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  var igPending = false;
  var successCount = 0, requestedCount = 0;

  const token = pageTokenForBrand(job.brand);
  if (!token) {
    await admin.from("meta_publish_jobs").update({
      status: "failed", error_code: "MISSING_TOKEN",
      error_message: "مفيش Meta Page Access Token متظبط للبراند ده (Edge Function secret)."
    }).eq("id", job.id);
    return;
  }

  const cfgRes = await admin.from("meta_brand_config").select("*").eq("brand", job.brand).maybeSingle();
  const brandCfg: BrandConfig | null = cfgRes.data as BrandConfig | null;
  if (!brandCfg || (!brandCfg.facebook_page_id && !brandCfg.instagram_business_account_id)) {
    await admin.from("meta_publish_jobs").update({
      status: "failed", error_code: "MISSING_BRAND_CONFIG",
      error_message: "مفيش meta_brand_config متظبط للبراند ده (facebook_page_id/instagram_business_account_id)."
    }).eq("id", job.id);
    return;
  }

  const contentRes = await admin.from("content_items").select("title, brand, body, caption_text, cta_text, hook_text, design_file_url, published_url, published_urls, content_format, carousel_slides").eq("id", job.content_id).maybeSingle();
  const content = contentRes.data as { title: string; brand: string | null; hook_text: string | null; body: string | null; caption_text: string | null; cta_text: string | null; design_file_url: string | null; published_url: string | null; published_urls: Record<string, string> | null; content_format: string | null; carousel_slides: unknown } | null;
  if (!content) {
    await admin.from("meta_publish_jobs").update({ status: "failed", error_code: "CONTENT_NOT_FOUND", error_message: "مادة المحتوى غير موجودة." }).eq("id", job.id);
    return;
  }
  const message: string = (globalThis as any).SSMPDPublicationText.compose(content);

  var imageUrl: string | null = null;
  var videoUrl: string | null = null;
  var carouselUrls: string[] = [];
  if (content.content_format === "video") {
    if (!content.design_file_url) {
      await admin.from("meta_publish_jobs").update({ status: "failed", error_code: "VIDEO_MISSING", error_message: "مفيش ملف فيديو مرفوع للمادة دي." }).eq("id", job.id);
      return;
    }
    try {
      videoUrl = await rehostImageToStorage(admin, job.id, content.design_file_url, "", true);
    } catch (e) {
      await admin.from("meta_publish_jobs").update({ status: "failed", error_code: "VIDEO_FETCH_ERROR", error_message: e instanceof Error ? e.message : String(e) }).eq("id", job.id);
      return;
    }
  } else if (content.content_format === "carousel") {
    const slides = carouselSlideUrls(job.content_id, content.carousel_slides);
    if (slides.length < 2) {
      await admin.from("meta_publish_jobs").update({ status: "failed", error_code: "CAROUSEL_SLIDES_MISSING", error_message: "الكاروسيل محتاج من ٢ لـ ١٠ صور مرفوعة من شاشة التصميم." }).eq("id", job.id);
      return;
    }
    try {
      for (let i = 0; i < slides.length; i++) carouselUrls.push(await rehostImageToStorage(admin, job.id, slides[i], `_${i + 1}`));
    } catch (e) {
      await admin.from("meta_publish_jobs").update({ status: "failed", error_code: "IMAGE_FETCH_ERROR", error_message: e instanceof Error ? e.message : String(e) }).eq("id", job.id);
      return;
    }
  } else if (content.design_file_url) {
    try {
      imageUrl = await rehostImageToStorage(admin, job.id, content.design_file_url);
    } catch (e) {
      const imageError = e instanceof Error ? e.message : String(e);
      await admin.from("meta_publish_jobs").update({
        status: "failed",
        error_code: "IMAGE_FETCH_ERROR",
        error_message: imageError
      }).eq("id", job.id);
      return;
    }
  }

  if (job.publish_facebook) {
    requestedCount++;
    if (!brandCfg.facebook_page_id) {
      errors.push("فيسبوك: facebook_page_id مش متظبط للبراند ده");
    } else if (job.facebook_post_id) {
      successCount++; // اتنشر في تشغيلة سابقة (الريل كان لسه بيتعالج على انستجرام)
    } else {
      const r = videoUrl
        ? await publishFacebookVideo(brandCfg.facebook_page_id, token, videoUrl, message)
        : carouselUrls.length
        ? await publishFacebookCarousel(brandCfg.facebook_page_id, token, carouselUrls, message)
        : imageUrl
        ? await publishFacebookPhoto(brandCfg.facebook_page_id, token, imageUrl, message)
        : await publishFacebookTextOnly(brandCfg.facebook_page_id, token, message);
      if (r.ok) {
        patch.facebook_post_id = r.postId; patch.facebook_permalink = r.permalink; successCount++;
      } else {
        errors.push("فيسبوك: " + r.error);
      }
    }
  }

  if (job.publish_instagram) {
    requestedCount++;
    if (!brandCfg.instagram_business_account_id) {
      errors.push("انستجرام: instagram_business_account_id مش متظبط للبراند ده");
    } else if (!imageUrl && !carouselUrls.length && !videoUrl) {
      errors.push("انستجرام: لازم صورة أو فيديو — مفيش ملف تصميم متاح.");
    } else if (videoUrl) {
      const r = await publishInstagramReel(brandCfg.instagram_business_account_id, token, videoUrl, message, job.instagram_container_id || null) as any;
      if (r.ok) {
        patch.instagram_container_id = r.containerId; patch.instagram_media_id = r.mediaId; patch.instagram_permalink = r.permalink; successCount++;
      } else if (r.pending) {
        patch.instagram_container_id = r.containerId; igPending = true;
      } else {
        if (r.containerId) patch.instagram_container_id = r.containerId;
        errors.push("انستجرام: " + r.error);
      }
    } else {
      const r = carouselUrls.length
        ? await publishInstagramCarousel(brandCfg.instagram_business_account_id, token, carouselUrls, message)
        : await publishInstagramSingleImage(brandCfg.instagram_business_account_id, token, imageUrl as string, message);
      if (r.ok) {
        patch.instagram_container_id = r.containerId; patch.instagram_media_id = r.mediaId; patch.instagram_permalink = r.permalink; successCount++;
      } else {
        if (r.containerId) patch.instagram_container_id = r.containerId;
        errors.push("انستجرام: " + r.error);
      }
    }
  }

  if (igPending && errors.length === 0 && job.attempt_count < 10) {
    // الريل لسه بيتعالج: نرجّع الـjob pending بعد دقيقة، ونحتفظ باللي اتنشر.
    patch.status = "pending";
    patch.scheduled_at = new Date(Date.now() + 60_000).toISOString();
    await admin.from("meta_publish_jobs").update(patch).eq("id", job.id);
    return;
  }
  if (igPending) errors.push("انستجرام: الريل ماخلصش معالجة بعد أكتر من محاولة");
  patch.status = successCount === 0 ? "failed" : (successCount < requestedCount ? "partial" : "published");
  if (errors.length) { patch.error_code = "PUBLISH_ERROR"; patch.error_message = errors.join(" | "); }
  if (patch.status === "published" || patch.status === "partial") patch.published_at = new Date().toISOString();

  await admin.from("meta_publish_jobs").update(patch).eq("id", job.id);

  if (patch.status === "published" || patch.status === "partial") {
    // بند ١ من المراجعة المعمارية (٢٠٢٦-٠٩-٠٨): مبنكتبش فوق رابط منشور
    // يدوي كان متسجّل قبل كده لمنصة تانية (زي تيكتوك/يوتيوب) — كل رابط
    // منصة بيتسجّل في published_urls[platform] من غير ما يمسح أي رابط
    // تاني، و published_url (القديم، للتوافق الخلفي) بيتحدّث بس لو فاضي.
    const mergedUrls: Record<string, string> = { ...(content.published_urls || {}) };
    if (patch.facebook_permalink) mergedUrls.facebook = patch.facebook_permalink as string;
    if (patch.instagram_permalink) mergedUrls.instagram = patch.instagram_permalink as string;
    const fallbackUrl = (patch.facebook_permalink as string) || (patch.instagram_permalink as string) || null;
    await admin.from("content_items").update({
      stage: "published",
      published_at: new Date().toISOString(),
      published_url: content.published_url || fallbackUrl,
      published_urls: mergedUrls
    }).eq("id", job.content_id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!CRON_SECRET || req.headers.get("X-Cron-Secret") !== CRON_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "MISCONFIGURED: no service role key" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const claimed = await admin.rpc("claim_due_meta_publish_jobs", { p_limit: 5 });
  if (claimed.error) return json({ ok: false, error: claimed.error.message }, 500);

  const jobs = claimed.data || [];
  for (const job of jobs) {
    try { await processJob(admin, job); }
    catch (e) {
      await admin.from("meta_publish_jobs").update({
        status: "failed", error_code: "UNEXPECTED_ERROR",
        error_message: e instanceof Error ? e.message : String(e)
      }).eq("id", job.id);
    }
  }
  return json({ ok: true, processed: jobs.length });
});

