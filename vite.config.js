import { defineConfig } from 'vite';

// In Docker dev the server runs in another container; use VITE_SERVER_URL env var.
// Locally (no Docker) it defaults to localhost:2567.
const SERVER_ORIGIN = process.env.VITE_SERVER_URL || 'http://localhost:2567';
const SERVER_WS     = SERVER_ORIGIN.replace( /^http/, 'ws' );

export default defineConfig( {
	// Serve models/sprites/audio as static assets in both dev and prod build
	publicDir: 'public',

	server: {
		port: 3000,
		host: '0.0.0.0',
		// HMR WebSocket must use the browser-visible host (localhost), not the container internal address
		hmr: {
			host: 'localhost',
			port: 3000,
		},
		// Use polling for file watching inside Docker on Windows (inotify doesn't cross volume mounts)
		watch: {
			usePolling: true,
			interval: 500,
		},
		// Proxy Colyseus in dev — in prod everything is served by the same express server
		proxy: {
			// REST endpoints
			'/matchmake': { target: SERVER_ORIGIN, changeOrigin: true },
			'/api':        { target: SERVER_ORIGIN, changeOrigin: true },
			// Colyseus WebSocket rooms: paths are /<processId>/<roomId>?sessionId=...
			// Both segments are exactly 9 alphanumeric chars (Colyseus nanoid default).
			// Static assets (/models/, /sprites/, etc.) never match this pattern.
			'^/[A-Za-z0-9]{9}/[A-Za-z0-9]{9}(\\?.*)?$': {
				target:       SERVER_WS,
				ws:           true,
				changeOrigin: true,
			},
		},
	},

	build: {
		outDir: 'dist',
		rollupOptions: {
			input: {
				main:   'index.html',
				editor: 'editor.html',
			},
		},
	},

	assetsInclude: [ '**/*.glb' ],
} );
