// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require("prism-react-renderer/themes/github");
const darkCodeTheme = require("prism-react-renderer/themes/dracula");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "ffmpeg.wasm",
  tagline:
    "ffmpeg.wasm is a pure WebAssembly / JavaScript port of FFmpeg enabling video & audio record, convert and stream right inside browsers!",
  url: "https://project516.dev",
  baseUrl: "/ffmpeg.wasm/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.ico",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "Project516", // Usually your GitHub org/user name.
  projectName: "ffmpeg.wasm", // Usually your repo name.

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            "https://github.com/Project516/ffmpeg.wasm/tree/master/apps/website",
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            "https://github.com/Project516/ffmpeg.wasm/tree/master/apps/website",
        },
        theme: {
          customCss: [
            require.resolve("./src/css/custom.css"),
            require.resolve("@fontsource/roboto/300.css"),
            require.resolve("@fontsource/roboto/400.css"),
            require.resolve("@fontsource/roboto/500.css"),
            require.resolve("@fontsource/roboto/700.css"),
          ],
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "ffmpeg.wasm",
        logo: {
          alt: "ffmpeg.wasm Logo",
          src: "img/logo192.png",
        },
        items: [
          {
            type: "doc",
            docId: "overview",
            position: "left",
            label: "Docs",
          },
          { to: "/playground", label: "Playground", position: "left" },
          { to: "/blog", label: "Blog", position: "left" },
          {
            href: "https://github.com/Project516/ffmpeg.wasm",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              {
                label: "Tutorial",
                to: "/docs/overview",
              },
            ],
          },
          {
            title: "Community",
            items: [
              {
                label: "Stack Overflow",
                href: "https://stackoverflow.com/questions/tagged/ffmpeg.wasm",
              },
            ],
          },
          {
            title: "More",
            items: [
              {
                label: "Blog",
                to: "/blog",
              },
              {
                label: "GitHub",
                href: "https://github.com/Project516/ffmpeg.wasm",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} ffmpeg.wasm contributors. Built with Docusaurus.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ['docker'],
      },
    }),
  plugins: [
    [require.resolve('@easyops-cn/docusaurus-search-local'), {
      indexDocs: true,
      indexBlog: true,
      hashed: true,
    }],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "ffmpeg",
        entryPoints: ["../../packages/ffmpeg/src/index.ts"],
        tsconfig: "../../packages/ffmpeg/tsconfig.json",
        readme: "none",
        out: "api/ffmpeg",
        sidebar: {
          indexLabel: "@project516/ffmpeg",
          fullNames: true,
        },
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "util",
        entryPoints: ["../../packages/util/src/index.ts"],
        tsconfig: "../../packages/util/tsconfig.json",
        readme: "none",
        out: "api/util",
        sidebar: {
          indexLabel: "@project516/util",
          fullNames: true,
        },
      },
    ],
  ],
  themes: ["@docusaurus/theme-live-codeblock"],
};

module.exports = config;
