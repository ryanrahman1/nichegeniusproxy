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
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        // Only allow GET requests
        if (request.method !== 'GET') {
            return new Response('Method not allowed', { 
                status: 405,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                }
            });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // Check for Genius token
        const geniusToken = env.GENIUS_ACCESS_TOKEN;
        if (!geniusToken) {
            return new Response('GENIUS_ACCESS_TOKEN not configured', { 
                status: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                }
            });
        }

        // Route: /song/{id}
        const songMatch = path.match(/^\/song\/(\d+)$/);
        if (songMatch) {
            try {
                const songId = songMatch[1];
                const data = await fetchGeniusSong(songId, geniusToken);
                
                return new Response(JSON.stringify(data), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({ 
                    error: error.message || 'Failed to fetch song' 
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }
        }

        // Route: /artist/{id}
        const artistMatch = path.match(/^\/artist\/(\d+)$/);
        if (artistMatch) {
            try {
                const artistId = artistMatch[1];
                const data = await fetchGeniusArtist(artistId, geniusToken);
                
                return new Response(JSON.stringify(data), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({ 
                    error: error.message || 'Failed to fetch artist' 
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }
        }

        // Root path - return API info
        if (path === '/' || path === '') {
            return new Response(JSON.stringify({
                message: 'Genius API Proxy',
                endpoints: {
                    song: '/song/{songId}',
                    artist: '/artist/{artistId}'
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // 404 for unknown routes
        return new Response(JSON.stringify({ 
            error: 'Not found. Use /song/{id} or /artist/{id}' 
        }), {
            status: 404,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    },
};
