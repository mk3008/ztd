import { defineConfig } from 'vitepress';
import type { DefaultTheme } from 'vitepress';
import typedocSidebar from '../api/typedoc-sidebar.json' with { type: 'json' };

const apiSidebar = typedocSidebar as DefaultTheme.SidebarItem[];
const apiSidebarWithIndex: DefaultTheme.SidebarItem[] = [
  { text: 'API Overview', link: '/api/index' },
  { text: 'Commands', link: '/api/commands' },
  ...apiSidebar,
];

export default defineConfig({
  title: 'Ashiba',
  description: 'Runtime-free SQL scaffolder for TypeScript applications.',
  lang: 'en-US',
  base: '/ashiba/',
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  srcDir: '.',
  head: [
    ['link', { rel: 'icon', type: 'image/jpeg', href: '/ashiba/brand/ashiba-icon.jpg' }],
  ],
  themeConfig: {
    logo: '/brand/ashiba-icon.jpg',
    nav: [
      { text: 'API', link: '/api/index' },
      { text: 'Concepts', link: '/concepts/concept-map' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'SSSQL Notation', link: '/guide/sssql' },
      ],
      '/api/': [
        ...apiSidebarWithIndex,
      ],
      '/concepts/': [
        { text: 'Concept Map', link: '/concepts/concept-map' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mk3008/ashiba' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright (c) 2026 Ashiba contributors',
    },
    editLink: {
      pattern: 'https://github.com/mk3008/ashiba/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    search: {
      provider: 'local',
    },
  },
});
