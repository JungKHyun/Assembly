import organization from "./org.json" with { type: "json" };
import { apply, cleanDb, FlowError } from "../web/flow.js";

const BLOB_PATH = "cases.json";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function requireToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN 환경변수가 설정되지 않음");
}

export function createBlobStorage() {
  return {
    async read() {
      requireToken();
      const { get } = await import("@vercel/blob");
      const result = await get(BLOB_PATH, { access: "public", useCache: false });
      if (!result) return { cases: [], log: [] };
      if (result.statusCode !== 200 || !result.stream) throw new Error("cases.json을 읽지 못함");
      return JSON.parse(await new Response(result.stream).text());
    },
    async write(db) {
      requireToken();
      const { put } = await import("@vercel/blob");
      await put(BLOB_PATH, JSON.stringify(db, null, 2), {
        access: "public",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    },
  };
}

export async function handle(request, dependencies = {}) {
  const storage = dependencies.storage || createBlobStorage();
  const org = dependencies.organization || organization;
  try {
    if (request.method === "GET") return json(cleanDb(await storage.read()));
    if (request.method !== "POST") return json({ error: "GET과 POST만 지원함" }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "올바른 JSON 요청이 아님" }, 400);
    }
    const current = await storage.read();
    const { db, result } = apply(current, body, org);
    await storage.write(db);
    return json(result);
  } catch (error) {
    if (error instanceof FlowError) return json({ error: error.message }, error.status);
    console.error("서버 처리 오류", error);
    return json({ error: "서버에서 자료를 처리하지 못함" }, 500);
  }
}

export default {
  fetch(request) {
    return handle(request);
  },
};
