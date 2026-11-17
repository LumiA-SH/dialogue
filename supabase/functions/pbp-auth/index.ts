import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const url = Deno.env.get("SUPABASE_URL")!;
const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publishable = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, adminKey, { auth: { persistSession: false } });
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const hash = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
};
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, "0")).join("");
const emailFor = (id: string) => "pbp-" + id + "@auth.invalid";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || "login");

    if (action === "login") {
      const code = String(body.code || "").trim();
      if (!/^[0-9a-f]{64}$/i.test(code)) return reply({ error: "접속 코드가 올바르지 않습니다." }, 401);

      const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
      const fingerprint = await hash(ip);
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count, error: countError } = await admin.from("auth_attempts").select("attempt_id", { count: "exact", head: true }).eq("code_fingerprint", fingerprint).gte("attempted_at", since);
      if (countError) throw countError;
      if ((count || 0) >= 10) return reply({ error: "잠시 후 다시 시도해 주세요." }, 429);
      const { error: attemptError } = await admin.from("auth_attempts").insert({ code_fingerprint: fingerprint });
      if (attemptError) throw attemptError;

      const tokenHash = await hash(code.toLowerCase());
      const { data: tokens, error } = await admin.from("user_tokens").select("user_id,expires_at,revoked_at").eq("token_hash", tokenHash).limit(1);
      if (error) throw error;
      const token = tokens?.[0];
      if (!token || token.revoked_at || (token.expires_at && new Date(token.expires_at).getTime() <= Date.now())) return reply({ error: "접속 코드가 올바르지 않습니다." }, 401);
      const { data: profile, error: profileError } = await admin.from("user").select("user_id,is_active,expires_at").eq("user_id", token.user_id).single();
      if (profileError || !profile || !profile.is_active || (profile.expires_at && new Date(profile.expires_at).getTime() <= Date.now())) return reply({ error: "계정이 비활성 상태입니다." }, 403);
      const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(token.user_id);
      if (authUserError || !authUser.user?.email) throw authUserError || Error("Auth user not found");
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: authUser.user.email });
      if (linkError || !link?.properties?.hashed_token) throw linkError || Error("Auth link generation failed");
      return reply({ token_hash: link.properties.hashed_token, email: authUser.user.email, type: "magiclink" });
    }

    const authorization = req.headers.get("Authorization") || "";
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    if (!bearer) return reply({ error: "Unauthorized" }, 401);
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(bearer);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error("PBP admin JWT claims failed", { message: claimsError?.message, code: claimsError?.code });
      return reply({ error: "Unauthorized" }, 401);
    }
    const user = { id: claimsData.claims.sub };
    const { data: actor } = await admin.from("user").select("role,is_active,expires_at").eq("user_id", user.id).single();
    if (actor?.role !== 1 || !actor.is_active || (actor.expires_at && new Date(actor.expires_at).getTime() <= Date.now())) return reply({ error: "Admin only" }, 403);


    if (action === "list-users") {
      const page = Math.max(0, Math.min(10000, Math.floor(Number(body.page) || 0)));
      const { data, error, count } = await admin.from("user")
        .select("user_id,user_name,user_portrait,role,is_active,expires_at,created_at", { count: "exact" })
        .order("created_at", { ascending: false }).order("user_id").range(page * 50, page * 50 + 49);
      if (error) throw error;
      return reply({ users: data || [], total: count || 0, actor_id: user.id });
    }
    if (action === "set-user-status") {
      const target = String(body.user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)) return reply({ error: "올바른 사용자 ID가 필요합니다." }, 400);
      if (target === user.id) return reply({ error: "현재 로그인한 관리자 자신의 상태는 변경할 수 없습니다." }, 400);
      if (!["activate", "deactivate", "expire"].includes(body.status)) return reply({ error: "지원하지 않는 계정 상태입니다." }, 400);
      const values = body.status === "activate" ? { is_active: true, expires_at: null }
        : body.status === "deactivate" ? { is_active: false } : { expires_at: new Date().toISOString() };
      const { data, error } = await admin.from("user").update(values).eq("user_id", target)
        .select("user_id,is_active,expires_at").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "사용자를 찾을 수 없습니다." }, 404);
      return reply({ user: data });
    }

    if (action === "list-active-codes") {
      const { data: tokens, error: tokenError } = await admin
        .from("user_tokens")
        .select("token_id,user_id,created_at,expires_at,vault_secret_id")
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (tokenError) throw tokenError;

      const current = Date.now();
      const active = (tokens || []).filter(token =>
        !token.expires_at || new Date(token.expires_at).getTime() > current
      );
      const userIds = [...new Set(active.map(token => token.user_id))];
      let users: { user_id: string; user_name: string }[] = [];

      if (userIds.length) {
        const { data: userRows, error: userError } = await admin
          .from("user")
          .select("user_id,user_name")
          .in("user_id", userIds);
        if (userError) throw userError;
        users = userRows || [];
      }

      const names = new Map(users.map(user => [user.user_id, user.user_name]));
      return reply({
        tokens: active.map(token => ({
          token_id: token.token_id,
          user_id: token.user_id,
          user_name: names.get(token.user_id) || "사용자",
          created_at: token.created_at,
          expires_at: token.expires_at,
          recoverable: Boolean(token.vault_secret_id)
        }))
      });
    }

    if (action === "reveal-code") {
      const tokenId = String(body.token_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tokenId)) {
        return reply({ error: "올바르지 않은 토큰 ID입니다." }, 400);
      }

      const { data: code, error: revealError } = await admin.rpc(
        "pbp_reveal_user_token", { p_token_id: tokenId }
      );
      if (revealError) throw revealError;
      if (!code) return reply({ error: "토큰을 확인할 수 없습니다. 기존 발급 토큰은 재발급해 주세요." }, 404);
      return reply({ code });
    }

    if (action === "create-user") {
      const name = String(body.user_name || "User").trim().slice(0, 24) || "User";
      const provisionalId = crypto.randomUUID();
      const password = makeCode();
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email: emailFor(provisionalId), password, email_confirm: true });
      if (createError || !created.user) throw createError || Error("Create user failed");
      const id = created.user.id;
      const { error: emailError } = await admin.auth.admin.updateUserById(id, { email: emailFor(id), email_confirm: true });
      if (emailError) { await admin.auth.admin.deleteUser(id); throw emailError; }
      const { error: profileError } = await admin.from("user").insert({ user_id: id, user_name: name, role: 2 });
      if (profileError) {
        await admin.auth.admin.deleteUser(id);
        throw profileError;
      }
      const code = makeCode();
      const { error: tokenError } = await admin.rpc("pbp_store_user_token", { p_user_id: id, p_code: code, p_revoke_previous: false });
      if (tokenError) throw tokenError;
      return reply({ user_id: id, code });
    }

    if (action === "rotate-code") {
      const target = String(body.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(target)) return reply({ error: "Invalid user" }, 400);
      const { data: targetProfile } = await admin.from("user").select("user_id").eq("user_id", target).single();
      if (!targetProfile) return reply({ error: "User not found" }, 404);
      const code = makeCode();
      const { error: issueError } = await admin.rpc("pbp_store_user_token", {
        p_user_id: target,
        p_code: code,
        p_revoke_previous: true
      });
      if (issueError) throw issueError;
      return reply({ user_id: target, code });
    }

    if (action === "revoke-code") {
      const target = String(body.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(target)) return reply({ error: "Invalid user" }, 400);
      const { error } = await admin.from("user_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", target).is("revoked_at", null);
      if (error) throw error;
      return reply({ ok: true });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("PBP auth error", error);
    return reply({ error: "인증 처리에 실패했습니다." }, 500);
  }
});
