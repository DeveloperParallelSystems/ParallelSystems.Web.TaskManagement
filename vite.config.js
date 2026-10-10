import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: '/task-management/',
    plugins: [react()],
    server: {
        port: 5174,
        strictPort: true,
        proxy: {
            '/api/task-management': {
                target: process.env.PARALLEL_SYSTEMS_API_PROXY || 'http://localhost:5185',
                changeOrigin: true,
            },
        },
    },
    preview: {
        port: 4174,
        strictPort: true,
        proxy: {
            '/api/task-management': {
                target: process.env.PARALLEL_SYSTEMS_API_PROXY || 'http://localhost:5185',
                changeOrigin: true,
            },
        },
    },
});
