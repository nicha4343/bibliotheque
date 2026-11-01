import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerates the PNG icons in public/ from public/icon.svg: `npm run icons`.
const ACCENT = '#0F766E';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: ACCENT } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: ACCENT } },
  },
  images: ['public/icon.svg'],
});
