/**
 * P・SPO お気に入り自動同期用 Cloudflare Worker (KV版)
 * 
 * - GET  /api/favs?key=MY_KEY : 指定キーのお気に入り一覧を取得
 * - POST /api/favs            : 指定キーにお気に入り一覧を保存
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
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. お気に入り保存
    // POST /api/favs { "key": "MY_KEY", "favorites": ["honmachi", "daino", ...] }
    if (request.method === 'POST' && url.pathname.startsWith('/api/favs')) {
      try {
        const body = await request.json();
        const key = (body.key || url.searchParams.get('key') || '').trim().toUpperCase();
        const favorites = body.favorites || [];

        if (!key) {
          return new Response(JSON.stringify({ error: 'Sync key is required' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        // KVに保存（有効期限: 90日間）
        if (env.FAVS_KV) {
          await env.FAVS_KV.put(key, JSON.stringify(favorites), {
            expirationTtl: 60 * 60 * 24 * 90
          });
        }

        return new Response(JSON.stringify({ success: true, key, favorites }), {
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: corsHeaders
        });
      }
    }

    // 2. お気に入り取得
    // GET /api/favs?key=MY_KEY または GET /api/favs/:key
    if (request.method === 'GET' && url.pathname.startsWith('/api/favs')) {
      let key = url.searchParams.get('key') || url.pathname.replace('/api/favs/', '').replace('/api/favs', '');
      key = key.trim().toUpperCase();

      if (!key) {
        return new Response(JSON.stringify({ error: 'Sync key is required' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      let favorites = [];
      if (env.FAVS_KV) {
        const data = await env.FAVS_KV.get(key);
        if (data) {
          favorites = JSON.parse(data);
        }
      }

      return new Response(JSON.stringify({ success: true, key, favorites }), {
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ status: 'ok', service: 'P・SPO Sync API' }), {
      headers: corsHeaders
    });
  }
};
