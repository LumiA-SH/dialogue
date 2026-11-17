import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const pageArgs = (body: Record<string, unknown>) => {
  const page = Math.min(Math.max(Number(body.page) || 0, 0), 10000);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  return { start: Math.floor(page) * Math.floor(limit), end: (Math.floor(page) + 1) * Math.floor(limit) - 1 };
};
const roomError = (error: { message?: string }) => {
  if (error.message?.includes("ROOM_NOT_FOUND")) return reply({ error: "방을 찾을 수 없습니다." }, 404);
  if (error.message?.includes("ROOM_PRIVATE")) return reply({ error: "비공개 방은 초대를 수락한 뒤 참여할 수 있습니다." }, 403);
  if (error.message?.includes("INVITER_NOT_MEMBER")) return reply({ error: "방 참여자만 초대할 수 있습니다." }, 403);
  if (error.message?.includes("INVITE_NOT_FOUND")) return reply({ error: "초대를 찾을 수 없습니다." }, 404);
  if (error.message?.includes("ALREADY_MEMBER")) return reply({ error: "이미 참여 중인 사용자입니다." }, 409);
  if (error.message?.includes("SELF_INVITE")) return reply({ error: "본인을 초대할 수 없습니다." }, 400);
  if (error.message?.includes("USER_NOT_FOUND")) return reply({ error: "사용자를 찾을 수 없습니다." }, 404);
  if (error.message?.includes("INVITE_ALREADY_RESOLVED")) return reply({ error: "이미 처리된 초대입니다." }, 409);
  return null;
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "로그인이 필요합니다." }, 401);

    // Verify the JWT signature and expiry directly; getUser(token) produced
    // "Auth session missing!" for valid ES256 access tokens in this project.
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsError || typeof userId !== "string" || !isUuid(userId)) {
      console.error("PBP room JWT verification failed", { code: claimsError?.code, message: claimsError?.message });
      return reply({ error: "유효하지 않은 세션입니다." }, 401);
    }

    const { data: profile, error: profileError } = await admin
      .from("user").select("user_id,role,is_active,expires_at").eq("user_id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active || (profile.expires_at && new Date(profile.expires_at).getTime() <= Date.now())) return reply({ error: "계정을 찾을 수 없습니다." }, 403);

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const roomId = Number(body.room_id);
    const validRoomId = Number.isSafeInteger(roomId) && roomId > 0;
    const adminOnly = action === "create" || action === "update" ||
      action === "delete" || action === "set-visibility";
    if (adminOnly && profile.role !== 1) return reply({ error: "관리자 권한이 필요합니다." }, 403);

    if (action === "list") {
      const [{ data: memberships, error: memberError },
        { data: pending, error: inviteError }] = await Promise.all([
        admin.from("room_user").select("room_id").eq("user_id", userId),
        admin.from("room_invites").select("room_id").eq("invited_user_id", userId).eq("status", "pending")
      ]);
      if (memberError || inviteError) throw memberError || inviteError;
      const ownIds = new Set((memberships || []).map(x => x.room_id));
      const pendingIds = new Set((pending || []).map(x => x.room_id));
      const visibleIds = [...new Set([...ownIds, ...pendingIds])];
      const { start, end } = pageArgs(body);
      let query = admin.from("rooms")
        .select("room_id,room_name,room_img,scene_img,created_at,created_by,is_public")
        .order("created_at", { ascending: false }).range(start, end);
      if (visibleIds.length) {
        query = query.or("is_public.eq.true,room_id.in.(" + visibleIds.join(",") + ")");
      } else {
        query = query.eq("is_public", true);
      }
      const search = String(body.search || "").trim().slice(0, 60);
      if (search) query = query.ilike("room_name", "%" + search + "%");
      const { data, error } = await query;
      if (error) throw error;
      const { data: summaries, error: summariesError } = ownIds.size
        ? await admin.rpc("pbp_room_summaries", { p_user_id: userId })
        : { data: [], error: null };
      if (summariesError) throw summariesError;
      const summaryMap = new Map((summaries || []).map(item => [item.room_id, item]));
      return reply({ rooms: (data || []).map(room => {
        const summary = summaryMap.get(room.room_id);
        return {
          ...room,
          is_member: ownIds.has(room.room_id),
          is_invited: pendingIds.has(room.room_id),
          last_message_text: summary?.last_message_text || null,
          last_message_at: summary?.last_message_at || null,
          unread_count: Number(summary?.unread_count || 0)
        };
      }) });
    }

    if (action === "list-users") {
      const { start, end } = pageArgs(body);
      let query = admin.from("user").select("user_id,user_name")
        .neq("user_id", userId).order("user_name").range(start, end);
      const search = String(body.search || "").trim().slice(0, 60);
      if (search) query = query.ilike("user_name", "%" + search + "%");
      const { data, error } = await query;
      if (error) throw error;
      return reply({ users: data || [] });
    }

    if (action === "list-invites") {
      const { data: invites, error } = await admin.from("room_invites")
        .select("invite_id,room_id,invited_by,created_at")
        .eq("invited_user_id", userId).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      if (!invites?.length) return reply({ invites: [] });
      const roomIds = [...new Set(invites.map(x => x.room_id))];
      const inviterIds = [...new Set(invites.map(x => x.invited_by))];
      const [{ data: rooms, error: roomError }, { data: users, error: userError }] = await Promise.all([
        admin.from("rooms").select("room_id,room_name,room_img,is_public").in("room_id", roomIds),
        admin.from("user").select("user_id,user_name").in("user_id", inviterIds)
      ]);
      if (roomError || userError) throw roomError || userError;
      const roomMap = new Map((rooms || []).map(x => [x.room_id, x]));
      const userMap = new Map((users || []).map(x => [x.user_id, x.user_name]));
      return reply({ invites: invites.map(invite => ({
        ...invite, room: roomMap.get(invite.room_id) || null,
        inviter_name: userMap.get(invite.invited_by) || "사용자"
      })) });
    }

    const name = typeof body.room_name === "string" ? body.room_name.trim() : "";
    const roomImg = body.room_img == null || body.room_img === "" ? null : body.room_img;
    const sceneImg = body.scene_img == null || body.scene_img === "" ? null : body.scene_img;

    if (action === "create" || action === "update") {
      if (!name || name.length > 60) return reply({ error: "방 이름은 1~60자로 입력해 주세요." }, 400);
      if (roomImg !== null && (typeof roomImg !== "string" || roomImg.length > 2048)) {
        return reply({ error: "방 이미지 경로가 올바르지 않습니다." }, 400);
      }
      if (Object.prototype.hasOwnProperty.call(body, "scene_img") &&
          sceneImg !== null && (typeof sceneImg !== "string" || sceneImg.length > 2048)) {
        return reply({ error: "장면 배경 이미지 경로가 올바르지 않습니다." }, 400);
      }
      if (body.is_public !== undefined && typeof body.is_public !== "boolean") {
        return reply({ error: "공개 설정이 올바르지 않습니다." }, 400);
      }
    }

    if (action === "create") {
      const { data, error } = await admin.rpc("pbp_create_room_configured", {
        p_user_id: userId,
        p_room_name: name,
        p_room_img: roomImg,
        p_is_public: body.is_public !== false
      });
      if (error) throw error;
      if (sceneImg !== null) {
        const { data: updatedRoom, error: sceneError } = await admin.from("rooms")
          .update({ scene_img: sceneImg }).eq("room_id", data.room_id).select().single();
        if (sceneError) throw sceneError;
        return reply({ room: updatedRoom });
      }
      return reply({ room: data });
    }

    if (!validRoomId && action !== "accept-invite" && action !== "decline-invite") return reply({ error: "올바른 방 ID가 필요합니다." }, 400);

    if (action === "join") {
      const { data, error } = await admin.rpc("pbp_join_public_room", {
        p_room_id: roomId, p_user_id: userId
      });
      if (error) return roomError(error) || reply({ error: "방 참여 중 오류가 발생했습니다." }, 500);
      return reply(data);
    }

    if (action === "invite") {
      if (!isUuid(body.invited_user_id)) return reply({ error: "초대할 사용자 ID가 올바르지 않습니다." }, 400);
      const { data, error } = await admin.rpc("pbp_send_room_invite", {
        p_room_id: roomId, p_inviter_id: userId, p_invited_user_id: body.invited_user_id
      });
      if (error) return roomError(error) || reply({ error: "초대 중 오류가 발생했습니다." }, 500);
      return reply({ invite: data });
    }

    if (action === "members") {
      const { data: own, error: ownError } = await admin.from("room_user")
        .select("room_id").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
      if (ownError) throw ownError;
      if (!own) return reply({ error: "방 참여자만 조회할 수 있습니다." }, 403);
      const { data: members, error: memberError } = await admin.from("room_user")
        .select("user_id").eq("room_id", roomId);
      if (memberError) throw memberError;
      const ids = (members || []).map(x => x.user_id);
      if (!ids.length) return reply({ members: [] });
      const { data: users, error: userError } = await admin.from("user")
        .select("user_id,user_name,user_portrait").in("user_id", ids);
      if (userError) throw userError;
      return reply({ members: users || [] });
    }

    if (action === "accept-invite" || action === "decline-invite") {
      if (!isUuid(body.invite_id)) return reply({ error: "초대 ID가 올바르지 않습니다." }, 400);
      const { data, error } = await admin.rpc("pbp_respond_room_invite", {
        p_invite_id: body.invite_id,
        p_user_id: userId,
        p_accept: action === "accept-invite"
      });
      if (error) return roomError(error) || reply({ error: "초대 처리 중 오류가 발생했습니다." }, 500);
      return reply(data);
    }

    if (action === "update") {
      const values: Record<string, unknown> = { room_name: name, room_img: roomImg };
      if (Object.prototype.hasOwnProperty.call(body, "scene_img")) values.scene_img = sceneImg;
      if (typeof body.is_public === "boolean") values.is_public = body.is_public;
      const { data, error } = await admin.from("rooms")
        .update(values).eq("room_id", roomId).select().maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "방을 찾을 수 없습니다." }, 404);
      return reply({ room: data });
    }

    if (action === "set-visibility") {
      if (typeof body.is_public !== "boolean") return reply({ error: "공개 설정이 올바르지 않습니다." }, 400);
      const { data, error } = await admin.from("rooms")
        .update({ is_public: body.is_public }).eq("room_id", roomId).select().maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "방을 찾을 수 없습니다." }, 404);
      return reply({ room: data });
    }

    if (action === "delete") {
      const { data, error } = await admin.from("rooms")
        .delete().eq("room_id", roomId).select("room_id").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ error: "방을 찾을 수 없습니다." }, 404);
      return reply({ ok: true });
    }

    return reply({ error: "지원하지 않는 작업입니다." }, 400);
  } catch (error) {
    console.error("PBP rooms error", error);
    return reply({ error: "방 처리 중 오류가 발생했습니다." }, 500);
  }
});
