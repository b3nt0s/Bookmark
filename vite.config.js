// `npm run dev:web` (set API_URL to point at a backend on another port): serves frontend/ and forwards API calls (including Google sign-in) to the backend.
export default {
  root: "frontend",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": process.env.API_URL ?? "http://localhost:8000",
    },
  },
};
