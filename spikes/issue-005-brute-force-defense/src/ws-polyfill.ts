// Node < 22 has no global `WebSocket`. `@supabase/supabase-js` constructs a Realtime client (even
// though this spike uses AUTH only), and `@supabase/realtime-js` throws at createClient time without
// a WebSocket. Provide the `ws` implementation as the global. On Node 22+ the native WebSocket is
// already present and kept. Import this FIRST, before any createClient call.

import WebSocketImpl from 'ws';

const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WebSocketImpl as unknown;
}
