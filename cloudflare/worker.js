/**
 * P・SPO お気に入り同期用 Cloudflare Worker (KV版)
 * 
 * 機能:
 * - POST /api/favs : お気に入りリストを保存し、6桁の同期コードを発行
 * - GET  /api/favs/:code : 6桁の同期コードからお気に入りリストを取得
 * 
 * Cloudflareの無料枠（毎日10万回読み取り、1,000回書き込み）で完全無料で動作します。
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. お気に入り保存 & 同期コード発行
    // POST /api/favs { "favorites": ["honmachi", "daino", ...] }
    if (request.method === 'POST' && url.pathname === '/api/favs') {
      try {
        const body = await request.json();
        const favorites = body.favorites || [];

        // ランダムな6桁の英数コード生成（例: 7K9B2F）
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        // KVに保存（有効期限: 90日間 = 7,776,000秒）
        if (env.FAVS_KV) {
          await env.FAVS_KV.put(code, JSON.stringify(favorites), {
            expirationTtl: 60 * 60 * 24 * 90
          });
        }

        return new Response(JSON.stringify({ success: true, code, favorites }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. 同期コードからお気に入り取得
    // GET /api/favs/:code
    if (request.method === 'GET' && url.pathname.startsWith('/api/favs/')) {
      const code = url.pathname.replace('/api/favs/', '').trim().toUpperCase();
      if (!code) {
        return new Response(JSON.stringify({ error: 'Code is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let favorites = [];
      if (env.FAVS_KV) {
        const data = await env.FAVS_KV.get(code);
        if (data) {
          favorites = JSON.parse(data);
        } else {
          return new Response(JSON.stringify({ error: 'コードが見つかりません。有効期限切れかコードが間違っています。' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response(JSON.stringify({ success: true, code, favorites }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('P・SPO Sync Worker Running', { headers: corsHeaders });
  }
};
