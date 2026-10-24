// `npm run dev:web`: serves frontend/ and forwards API calls (including Google sign-in) to the backend.
export default {
  root: "frontend",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
};
