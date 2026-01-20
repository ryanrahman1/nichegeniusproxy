/**
 * Cloudflare Worker for Genius API Proxy
 * Handles routes: /song/{id} and /artist/{id}
 */

/**
 * Helper function to flatten Genius DOM structure into simplified spans and blocks
 * 
 * @param {*} dom Genius DOM structure
 * @returns array of blocks and spans
 */
function flattenGenius(dom) {
    const result = [];

    function walk(node, currentStyles = [], currentLink = null, isInsideBlock = false) {
        if (!node) return [];

        if (typeof node === 'string') {
            return [{ text: node, styles: [...currentStyles], link: currentLink }];
        }

        if (node.tag === 'br') {
            return [{ text: "\n", styles: [], link: null }];
        }

        if (node.tag === 'img') {
            result.push({
                type: 'image',
                url: node.attributes.src,
                alt: node.attributes.alt,
                width: node.attributes.width,
                height: node.attributes.height
            });
            return [];
        }

        if (['em', 'i', 'b', 'strong', 'a'].includes(node.tag)) {
            const newStyles = [...currentStyles];
            if (['em', 'i'].includes(node.tag)) newStyles.push('italic');
            if (['b', 'strong'].includes(node.tag)) newStyles.push('bold');
            const newLink = node.tag === 'a' ? node.attributes.href : currentLink;

            return (node.children || []).flatMap(child => 
                walk(child, newStyles, newLink, true)
            );
        }

        const isBlockTag = ['p', 'blockquote'].includes(node.tag);
        
        const childrenSpans = (node.children || []).flatMap(child => 
            walk(child, currentStyles, currentLink, isBlockTag ? true : isInsideBlock)
        );

        if (isBlockTag && !isInsideBlock) {
            if (childrenSpans.length > 0) {
                result.push({
                    type: node.tag === 'p' ? 'paragraph' : 'blockquote',
                    spans: childrenSpans
                });
            }
            return [];
        }

        return childrenSpans;
    }

    walk(dom);
    return result;
}

async function fetchGeniusArtist(artistId, geniusToken) {
    const res = await fetch(`https://api.genius.com/artists/${artistId}`, {
        headers: {
            'Authorization': `Bearer ${geniusToken}`
        }
    });

    if (!res.ok) {
        throw new Error(`Genius API error: ${res.status} ${res.statusText}`);
    }

    const parsed = await res.json();
    const artist = parsed.response.artist;

    const full = {
        name: artist.name,
        description: flattenGenius(artist.description.dom),
        url: artist.url
    };

    return full;
}

async function fetchGeniusSong(songId, geniusToken) {
    const res = await fetch(`https://api.genius.com/songs/${songId}`, {
        headers: {
            'Authorization': `Bearer ${geniusToken}`
        }
    });

    if (!res.ok) {
        throw new Error(`Genius API error: ${res.status} ${res.statusText}`);
    }

    const parsed = await res.json();
    const song = parsed.response.song;

    const full = {
        artist_names: song.artist_names,
        description: flattenGenius(song.description.dom),
        title: song.title,
        language: song.language,
        release_date: song.release_date,
        title_with_featured: song.title_with_featured,
        url: song.url,
        primary_color: song.song_art_primary_color,
        secondary_color: song.song_art_secondary_color,
        album: song.album ? {
            name: song.album.name,
            primary_artist: song.album.primary_artists[0].name,
            release_date: song.album.release_date_for_display,
            url: song.album.url
        } : null
    };

    return full;
}

/**
 * Main request handler
 */
export default {
    async fetch(request, env, ctx) {
        // 1. Security Check (Must happen before cache check for safety)
        const clientSecret = request.headers.get("X-Proxy-Secret");
        if (clientSecret !== env.PROXY_SECRET) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
                status: 401,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // 2. Rate Limiting
        if (env.RATE_LIMITER) {
            const clientIP = request.headers.get("CF-Connecting-IP") || "anonymous";
            const { success } = await env.RATE_LIMITER.limit({ key: clientIP });
            if (!success) {
                return new Response(JSON.stringify({ error: 'Too Many Requests' }), { 
                    status: 429,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        // 3. Cache Match (Check if we already have this exact request)
        const cache = caches.default;
        let response = await cache.match(request);

        if (response) {
            // Found in cache! Return immediately.
            // We clone the response to add a custom header so you can verify the HIT
            let hitResponse = new Response(response.body, response);
            hitResponse.headers.set('X-Proxy-Cache', 'HIT');
            return hitResponse;
        }

        // 4. Standard Handlers (OPTIONS, Method check)
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        if (request.method !== 'GET') {
            return new Response('Method not allowed', { 
                status: 405, 
                headers: { 'Access-Control-Allow-Origin': '*' } 
            });
        }

        // 5. Logic Execution (This is the slow part)
        const url = new URL(request.url);
        const path = url.pathname;
        const geniusToken = env.GENIUS_ACCESS_TOKEN;

        if (!geniusToken) {
            return new Response('GENIUS_ACCESS_TOKEN not configured', { status: 500 });
        }

        const songMatch = path.match(/^\/song\/(\d+)$/);
        const artistMatch = path.match(/^\/artist\/(\d+)$/);

        try {
            let data;
            if (songMatch) {
                data = await fetchGeniusSong(songMatch[1], geniusToken);
            } else if (artistMatch) {
                data = await fetchGeniusArtist(artistMatch[1], geniusToken);
            } else if (path === '/' || path === '') {
                data = { message: 'Genius API Proxy', endpoints: { song: '/song/{id}', artist: '/artist/{id}' } };
            } else {
                return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
            }

            // 6. Create Response & Store in Cache
            // s-maxage=86400 tells Cloudflare to keep this for 24 hours
            response = new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, s-maxage=86400, max-age=3600',
                    'X-Proxy-Cache': 'MISS'
                },
            });

            // ctx.waitUntil ensures the cache write happens in the background 
            // after the user gets their data
            ctx.waitUntil(cache.put(request, response.clone()));

            return response;
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }
    },
};