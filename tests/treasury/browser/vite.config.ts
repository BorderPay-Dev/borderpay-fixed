import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:[{find:'./treasury/api',replacement:path.resolve('tests/treasury/browser/api.ts')}],dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5187}});
