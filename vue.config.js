const { defineConfig } = require("@vue/cli-service")

module.exports = defineConfig({
  publicPath: "./",
  productionSourceMap: false,
  // Lint problems are warnings in the dev server (they used to block the
  // rebuild, so a style nit froze the preview). `yarn lint` still fails on them.
  lintOnSave: "warning",

  // The size hints only ever flag the data files (public/data/cone, budgeted by pipeline/web_pack.py) and
  // three.js itself; they are known and checked there, not here.
  configureWebpack: {
    performance: { hints: false },
  },

  // Needed for testing on real phones over the LAN. This makes the dev server
  // insecure, but that's OK since we only use it in controlled circumstances.
  devServer: {
    allowedHosts: 'all',
    client: {
      overlay: false
    }
  }
});
