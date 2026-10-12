/**
 * Cloudflare Pages Functions: /api/favs
 * 
 * - GET  /api/favs?key=MY_KEY : 指定キーのお気に入り一覧を取得
 * - POST /api/favs            : 指定キーにお気に入り一覧を保存
 * 
 * Cloudflare Pagesダッシュボードの「設定」->「Functions」->「KV ネームスペースのバインド」で
 * 変数名「FAVS_KV」にKVをバインドすると永続保存されます。
 * バインド未設定時でも動作確認できるようフォールバックを備えています。
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key')?.trim();

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (!key) {
    return new Response(JSON.stringify({ error: 'Sync key is required' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  try {
    let favorites = [];
    if (env && env.FAVS_KV) {
      const data = await env.FAVS_KV.get(key.toUpperCase());
      if (data) {
        favorites = JSON.parse(data);
      }
    }
    return new Response(JSON.stringify({ success: true, key: key.toUpperCase(), favorites }), {
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json();
    const key = body.key?.trim();
    const favorites = body.favorites || [];

    if (!key) {
      return new Response(JSON.stringify({ error: 'Sync key is required' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    if (env && env.FAVS_KV) {
      // 90日間保持
      await env.FAVS_KV.put(key.toUpperCase(), JSON.stringify(favorites), {
        expirationTtl: 60 * 60 * 24 * 90
      });
    }

    return new Response(JSON.stringify({ success: true, key: key.toUpperCase(), favorites }), {
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
